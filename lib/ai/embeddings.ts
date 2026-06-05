import { openai } from "@ai-sdk/openai"
import { embedMany, type EmbeddingModel } from "ai"

export async function embedTexts(
  texts: string[],
  opts: { model?: EmbeddingModel } = {},
): Promise<number[][]> {
  if (texts.length === 0) return []
  const { embeddings } = await embedMany({
    model: opts.model ?? openai.embedding("text-embedding-3-small"),
    values: texts,
  })
  return embeddings
}

export async function embedQuery(
  text: string,
  opts: { model?: EmbeddingModel } = {},
): Promise<number[]> {
  const [vec] = await embedTexts([text], opts)
  return vec
}
