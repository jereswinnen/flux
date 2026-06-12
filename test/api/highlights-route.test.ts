import { afterEach, expect, test, vi } from "vitest"

const created: Record<string, unknown>[] = []
vi.mock("@/lib/db/highlights", () => ({
  highlightRepo: {
    create: vi.fn(async (v: Record<string, unknown>) => {
      const row = { id: "h-new", createdAt: new Date(), note: null, locator: null, ...v }
      created.push(row)
      return row
    }),
    list: vi.fn(async () => []),
  },
}))

afterEach(() => {
  created.length = 0
  vi.clearAllMocks()
})

test("POST creates a highlight", async () => {
  const { POST } = await import("@/app/api/highlights/route")
  const res = await POST(
    new Request("http://t/api/highlights", {
      method: "POST",
      body: JSON.stringify({ itemId: "i1", kind: "transcript", text: "hi", locator: { sec: 5 } }),
    }),
  )
  expect(res.status).toBe(201)
  expect(created[0]).toMatchObject({ itemId: "i1", kind: "transcript", text: "hi" })
})

test("POST rejects empty text", async () => {
  const { POST } = await import("@/app/api/highlights/route")
  const res = await POST(
    new Request("http://t/api/highlights", {
      method: "POST",
      body: JSON.stringify({ itemId: "i1", kind: "transcript", text: "   " }),
    }),
  )
  expect(res.status).toBe(400)
})

test("POST rejects an unknown kind", async () => {
  const { POST } = await import("@/app/api/highlights/route")
  const res = await POST(
    new Request("http://t/api/highlights", {
      method: "POST",
      body: JSON.stringify({ itemId: "i1", kind: "bogus", text: "hi" }),
    }),
  )
  expect(res.status).toBe(400)
})
