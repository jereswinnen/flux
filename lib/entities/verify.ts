import { openai } from "@ai-sdk/openai"
import { generateObject, type LanguageModel } from "ai"
import { z } from "zod"
import type { Candidate } from "@/lib/entities/sources"
import type { EntityType } from "@/lib/db/schema"

const verdictSchema = z.object({
  candidateIndex: z
    .number()
    .describe("0-based index of the candidate that is the same real-world thing, or -1 if none clearly match"),
})

export interface MentionToVerify {
  name: string
  type: EntityType | string
  context?: string
}

// One cheap structured call per *new* entity: given the mention (with its
// transcript context) and external candidates, pick the right one or reject
// all. Precision over recall — a wrong match on an entity page is worse than
// an unenriched entity.
export async function verifyCandidate(
  mention: MentionToVerify,
  candidates: Candidate[],
  opts: { model?: LanguageModel; episodeTitle?: string } = {},
): Promise<number> {
  if (candidates.length === 0) return -1

  const list = candidates
    .map(
      (c, i) =>
        `${i}. [${c.source}] ${c.title}${c.description ? ` — ${c.description}` : ""}` +
        (c.summary ? `\n   ${c.summary.slice(0, 300)}` : ""),
    )
    .join("\n")

  const { object } = await generateObject({
    model: opts.model ?? openai("gpt-5.4-mini-2026-03-17"),
    schema: verdictSchema,
    prompt:
      "You match podcast mentions to knowledge-base records.\n\n" +
      `Mention: "${mention.name}" (type: ${mention.type})\n` +
      (mention.context ? `How it came up: ${mention.context}\n` : "") +
      (opts.episodeTitle ? `Episode: ${opts.episodeTitle}\n` : "") +
      `\nCandidates:\n${list}\n\n` +
      "Return the candidateIndex of the record that refers to the same real-world thing as the " +
      "mention, or -1 if none clearly do. Prefer -1 over guessing.",
  })

  const idx = Math.trunc(object.candidateIndex)
  return idx >= 0 && idx < candidates.length ? idx : -1
}
