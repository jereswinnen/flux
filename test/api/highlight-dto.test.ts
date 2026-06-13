import { describe, expect, it } from "vitest"
import { highlightToDTO } from "@/lib/api/highlight-dto"

describe("highlightToDTO", () => {
  it("maps a transcript highlight with a jump href + ISO date", () => {
    const dto = highlightToDTO({
      id: "h1",
      kind: "transcript",
      text: "hello",
      note: null,
      locator: { sec: 42 },
      createdAt: new Date("2026-01-02T03:04:05Z"),
      item: { id: "i1", type: "youtube", title: "Vid", source: "Chan", artworkUrl: null },
    })
    expect(dto).toMatchObject({
      id: "h1",
      kind: "transcript",
      text: "hello",
      note: null,
      createdAt: "2026-01-02T03:04:05.000Z",
      jumpHref: "/items/i1?t=42",
      item: { id: "i1", type: "youtube", title: "Vid", source: "Chan", artworkUrl: null },
    })
  })
  it("takeaway → bare item href", () => {
    const dto = highlightToDTO({
      id: "h2",
      kind: "takeaway",
      text: "t",
      note: "n",
      locator: { index: 1 },
      createdAt: new Date("2026-01-01T00:00:00Z"),
      item: { id: "i2", type: "podcast", title: "Ep", source: null, artworkUrl: null },
    })
    expect(dto.jumpHref).toBe("/items/i2")
  })
})
