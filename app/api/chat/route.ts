import { openai } from "@ai-sdk/openai"
import { streamText, type ModelMessage } from "ai"
import { embedQuery } from "@/lib/ai/embeddings"
import { db } from "@/lib/db"
import { conversationRepo } from "@/lib/db/conversations"
import { searchChunks } from "@/lib/db/search"
import { formatTimestamp } from "@/lib/format"
import type { ChatSource } from "@/lib/db/schema"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body?.conversationId || !body?.content) {
    return Response.json({ error: "conversationId and content are required" }, { status: 400 })
  }

  const data = await conversationRepo.get(body.conversationId)
  if (!data) return Response.json({ error: "conversation not found" }, { status: 404 })

  const episodeId = data.conversation.episodeId
  const content: string = body.content

  await conversationRepo.addMessage({ conversationId: body.conversationId, role: "user", content })
  await conversationRepo.setTitleFromFirstMessage(body.conversationId, content)

  const hits = await searchChunks(db, await embedQuery(content), {
    limit: 8,
    episodeId: episodeId ?? undefined,
  })
  const libraryWide = !episodeId
  const context = hits
    .map((h) =>
      libraryWide
        ? `[${h.episodeTitle} — ${formatTimestamp(h.startSec)}] ${h.content}`
        : `[${formatTimestamp(h.startSec)}] ${h.content}`,
    )
    .join("\n\n")
  const sources: ChatSource[] = hits.map((h) => ({
    episodeId: h.episodeId,
    episodeTitle: h.episodeTitle,
    startSec: h.startSec,
  }))

  const history: ModelMessage[] = data.messages.map((m) => ({ role: m.role, content: m.content }))
  const messages: ModelMessage[] = [...history, { role: "user", content }]

  const result = streamText({
    model: openai("gpt-5.4-mini-2026-03-17"),
    system:
      "You are answering questions about podcast transcripts using ONLY the provided excerpts. " +
      (libraryWide
        ? "Cite the episode title and [timestamp] you rely on. "
        : "Cite the [timestamp] you rely on. ") +
      "Use markdown. If the answer isn't in the excerpts, say so.\n\nExcerpts:\n" +
      context,
    messages,
    onFinish: async ({ text }) => {
      await conversationRepo.addMessage({
        conversationId: body.conversationId,
        role: "assistant",
        content: text,
        sources,
      })
      await conversationRepo.touch(body.conversationId)
    },
  })

  return result.toTextStreamResponse({
    headers: { "x-sources": encodeURIComponent(JSON.stringify(sources)) },
  })
}
