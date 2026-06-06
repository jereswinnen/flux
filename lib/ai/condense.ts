import { openai } from "@ai-sdk/openai"
import { generateText, type LanguageModel } from "ai"

type Turn = { role: "user" | "assistant"; content: string }

export async function condenseQuery(
  history: Turn[],
  question: string,
  opts: { model?: LanguageModel } = {},
): Promise<string> {
  if (history.length === 0) return question
  const transcript = history.map((m) => `${m.role}: ${m.content}`).join("\n")
  const { text } = await generateText({
    model: opts.model ?? openai("gpt-5.4-mini-2026-03-17"),
    prompt:
      "Given the conversation so far and a follow-up question, rewrite the follow-up as a standalone " +
      "search query (no preamble, just the query).\n\nConversation:\n" +
      transcript +
      "\n\nFollow-up: " +
      question +
      "\n\nStandalone query:",
  })
  return text.trim() || question
}
