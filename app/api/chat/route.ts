import { openai } from "@ai-sdk/openai"
import { streamText, type ModelMessage } from "ai"
import { eq } from "drizzle-orm"
import { embedQuery } from "@/lib/ai/embeddings"
import { condenseQuery } from "@/lib/ai/condense"
import { buildTranscriptContext, estimateTokens, MAX_TRANSCRIPT_TOKENS } from "@/lib/ai/episode-context"
import { db } from "@/lib/db"
import { conversationRepo } from "@/lib/db/conversations"
import { searchChunks, hybridSearch, refineHitTimestamps } from "@/lib/db/search"
import { transcripts } from "@/lib/db/schema"
import { formatTimestamp } from "@/lib/format"
import type { ChatSource } from "@/lib/db/schema"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body?.conversationId) {
    return Response.json({ error: "conversationId is required" }, { status: 400 })
  }
  const conversationId: string = body.conversationId
  const isRegenerate = !!body.regenerate
  const editFromMessageId: string | undefined = body.editFromMessageId

  let data = await conversationRepo.get(conversationId)
  if (!data) return Response.json({ error: "conversation not found" }, { status: 404 })

  let content: string
  if (isRegenerate) {
    const lastUser = [...data.messages].reverse().find((m) => m.role === "user")
    if (!lastUser) return Response.json({ error: "nothing to regenerate" }, { status: 400 })
    const after = data.messages.find((m) => new Date(m.createdAt) > new Date(lastUser.createdAt))
    if (after) await conversationRepo.truncateFrom(conversationId, after.id)
    data = (await conversationRepo.get(conversationId))!
    content = lastUser.content
  } else if (editFromMessageId) {
    if (!body.content) return Response.json({ error: "content is required" }, { status: 400 })
    await conversationRepo.truncateFrom(conversationId, editFromMessageId)
    content = body.content
    await conversationRepo.addMessage({ conversationId, role: "user", content })
    data = (await conversationRepo.get(conversationId))!
  } else {
    if (!body.content) return Response.json({ error: "content is required" }, { status: 400 })
    content = body.content
    await conversationRepo.addMessage({ conversationId, role: "user", content })
    await conversationRepo.setTitleFromFirstMessage(conversationId, content)
    data = (await conversationRepo.get(conversationId))!
  }

  const episodeId = data.conversation.episodeId
  const messages: ModelMessage[] = data.messages.map((m) => ({ role: m.role, content: m.content }))
  const priorTurns = data.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }))

  const libraryWide = !episodeId
  let context = ""
  let sources: ChatSource[] = []

  if (episodeId) {
    const [t] = await db.select().from(transcripts).where(eq(transcripts.episodeId, episodeId)).limit(1)
    const full = t?.segments ? buildTranscriptContext(t.segments) : ""
    if (full && estimateTokens(full) <= MAX_TRANSCRIPT_TOKENS) {
      context = full
    } else {
      const hits = await searchChunks(db, await embedQuery(content), { limit: 10, episodeId })
      context = hits.map((h) => `[${formatTimestamp(h.startSec)}] ${h.content}`).join("\n\n")
      sources = hits.map((h) => ({
        episodeId: h.episodeId,
        episodeTitle: h.episodeTitle,
        startSec: h.startSec,
        podcastName: h.podcastName,
        artworkUrl: h.artworkUrl,
        audioUrl: h.audioUrl,
      }))
    }
  } else {
    const searchQuery = await condenseQuery(priorTurns, content)
    const rawHits = await hybridSearch(db, await embedQuery(searchQuery), searchQuery, { limit: 8 })
    const hits = await refineHitTimestamps(db, rawHits, searchQuery)
    context = hits
      .map((h, i) => `[${i + 1}] (${h.episodeTitle} — ${formatTimestamp(h.startSec)}) ${h.content}`)
      .join("\n\n")
    sources = hits.map((h) => ({
      episodeId: h.episodeId,
      episodeTitle: h.episodeTitle,
      startSec: h.startSec,
      podcastName: h.podcastName,
      artworkUrl: h.artworkUrl,
      audioUrl: h.audioUrl,
    }))
  }

  const result = streamText({
    model: openai("gpt-5.4-mini-2026-03-17"),
    system:
      "You are answering questions about podcast transcripts using ONLY the provided excerpts. " +
      (libraryWide
        ? "The excerpts are numbered; cite the claims you rely on with the matching [n] (e.g. [1], [2][3]). Do not write out episode titles inline. "
        : "Cite the [timestamp] you rely on. ") +
      "Use markdown. If the answer isn't in the excerpts, say so.\n\nExcerpts:\n" +
      context,
    messages,
    onFinish: async ({ text }) => {
      await conversationRepo.addMessage({ conversationId, role: "assistant", content: text, sources })
      await conversationRepo.touch(conversationId)
    },
  })

  return result.toTextStreamResponse({
    headers: { "x-sources": encodeURIComponent(JSON.stringify(sources)) },
  })
}
