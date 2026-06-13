import { describe, expect, it } from "vitest"
import { buildInsightsPrompt } from "@/lib/ai/insights"

describe("buildInsightsPrompt", () => {
  it("article prompt: no chapters, article framing, zero timestamps", () => {
    const p = buildInsightsPrompt("BODY", "article")
    expect(p).toContain("web article")
    expect(p).toContain("this article")
    expect(p).toContain("empty array")
    expect(p).not.toContain("[m:ss]")
    expect(p).toContain("BODY")
  })
  it("media prompt: chapters + timestamps", () => {
    const p = buildInsightsPrompt("BODY", "youtube")
    expect(p).toContain("chronological")
    expect(p).toContain("[m:ss]")
  })
})
