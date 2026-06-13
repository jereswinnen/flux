import { expect, test } from "vitest"
import { buildTranscriptContext, estimateTokens } from "@/lib/ai/transcript-context"

test("formats segments as [mm:ss] lines", () => {
  const ctx = buildTranscriptContext([
    { start: 0, end: 5, text: "hello" },
    { start: 65, end: 70, text: "world" },
  ])
  expect(ctx).toBe("[0:00] hello\n[1:05] world")
})

test("estimateTokens approximates by chars", () => {
  expect(estimateTokens("a".repeat(40))).toBe(10)
})
