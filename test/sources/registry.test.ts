import { describe, expect, it } from "vitest"
import { detectAdapter, getAdapter } from "@/lib/sources/registry"

describe("registry", () => {
  it("detects youtube by url", () => {
    expect(detectAdapter("https://youtu.be/dQw4w9WgXcQ")?.type).toBe("youtube")
  })
  it("returns null when no url adapter matches", () => {
    expect(detectAdapter("https://anchor.fm/x.mp3")).toBeNull()
  })
  it("gets an adapter by explicit type", () => {
    expect(getAdapter("podcast").type).toBe("podcast")
    expect(getAdapter("youtube").type).toBe("youtube")
  })
})
