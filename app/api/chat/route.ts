import { openai } from "@ai-sdk/openai"
import { streamText, stepCountIs, type ModelMessage } from "ai"
import { eq } from "drizzle-orm"
import { embedQuery } from "@/lib/ai/embeddings"
import { condenseQuery } from "@/lib/ai/condense"
import { buildTranscriptContext, estimateTokens, MAX_TRANSCRIPT_TOKENS } from "@/lib/ai/episode-context"
import { db } from "@/lib/db"
import { conversationRepo } from "@/lib/db/conversations"
import { searchChunks, hybridSearch, refineHitTimestamps, searchHighlights } from "@/lib/db/search"
import { assembleAskSources, type AskSourceEntry } from "@/lib/ai/ask-sources"
import { groupHitsIntoSources } from "@/lib/ai/group-sources"
import { transcripts } from "@/lib/db/schema"
import { formatTimestamp } from "@/lib/format"
import type { ChatSource } from "@/lib/db/schema"
import { toWebSources } from "@/lib/ai/web-sources"

function entryToChatSource(e: AskSourceEntry): ChatSource {
  const base = {
    itemId: e.hit.itemId,
    itemTitle: e.hit.itemTitle,
    startSec: e.hit.startSec,
    podcastName: e.hit.podcastName,
    artworkUrl: e.hit.artworkUrl,
    audioUrl: e.hit.audioUrl,
    videoId: e.hit.videoId,
  }
  return e.kind === "highlight" ? { ...base, isHighlight: true, snippet: e.hit.text } : base
}

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

  // Episode scope is per-message: an episode can be "attached" to a single
  // question (the `@` mention in the composer). Fall back to a legacy
  // episode-scoped conversation if one exists.
  const attachedItemId =
    typeof body.itemId === "string" && body.itemId ? body.itemId : undefined
  const itemId = attachedItemId ?? data.conversation.itemId
  const messages: ModelMessage[] = data.messages.map((m) => ({ role: m.role, content: m.content }))
  const priorTurns = data.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }))

  const libraryWide = !itemId
  let context = ""
  let sources: ChatSource[] = []

  if (itemId) {
    const [t] = await db.select().from(transcripts).where(eq(transcripts.itemId, itemId)).limit(1)
    const full = t?.segments ? buildTranscriptContext(t.segments) : ""
    // One query embedding, reused for chunk fallback (if needed) + highlights.
    const qe = await embedQuery(content)
    if (full && estimateTokens(full) <= MAX_TRANSCRIPT_TOKENS) {
      context = full
    } else {
      const hits = await searchChunks(db, qe, { limit: 10, itemId })
      const { sources: grouped } = groupHitsIntoSources(hits)
      context = hits.map((h) => `[${formatTimestamp(h.startSec)}] ${h.content}`).join("\n\n")
      sources = grouped.map((h) => ({
        itemId: h.itemId, itemTitle: h.itemTitle, startSec: h.startSec,
        podcastName: h.podcastName, artworkUrl: h.artworkUrl, audioUrl: h.audioUrl, videoId: h.videoId,
      }))
    }
    const hlHits = await searchHighlights(db, qe, { itemId, limit: 3 })
    if (hlHits.length) {
      context += "\n\nHighlights you saved on this item:\n" + hlHits.map((h) => `- ${h.text}`).join("\n")
      // n is unused for highlight entries (entryToChatSource ignores it).
      sources = [...sources, ...hlHits.map((h) => entryToChatSource({ kind: "highlight", n: 0, hit: h }))]
    }
  } else {
    const searchQuery = await condenseQuery(priorTurns, content)
    const qe = await embedQuery(searchQuery)
    const [rawHits, hlHits] = await Promise.all([
      hybridSearch(db, qe, searchQuery, { limit: 8 }),
      searchHighlights(db, qe, {}),
    ])
    const chunkHits = await refineHitTimestamps(db, rawHits, searchQuery)
    const assembled = assembleAskSources(chunkHits, hlHits)
    context = assembled.context
    sources = assembled.entries.map(entryToChatSource)
  }

  const result = streamText({
    model: openai("gpt-5.4-mini-2026-03-17"),
    tools: { web_search: openai.tools.webSearch() },
    stopWhen: stepCountIs(3),
    system:
      "You are answering questions about a personal podcast/article library using the provided excerpts. " +
      "Answer primarily from them. If they don't fully cover the question, or it needs current/external " +
      "information, use the web_search tool and integrate what you find — prefer the library, use the web " +
      "to supplement. Be thorough and specific. " +
      (libraryWide
        ? "The excerpts are numbered; cite the claims you rely on with the matching [n]. Do not write episode titles inline. "
        : "Cite the [timestamp] you rely on. ") +
      "If neither the excerpts nor the web answer it, say so.\n\nExcerpts:\n" +
      context,
    messages,
    onFinish: async ({ text, sources: modelSources }) => {
      const finalSources = [...sources, ...toWebSources((modelSources ?? []) as never)]
      await conversationRepo.addMessage({ conversationId, role: "assistant", content: text, sources: finalSources })
      await conversationRepo.touch(conversationId)
    },
  })

  return result.toUIMessageStreamResponse({
    headers: { "x-sources": encodeURIComponent(JSON.stringify(sources)) },
  })
}
