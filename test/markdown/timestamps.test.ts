import { expect, test } from "vitest"
import { splitTimestamps } from "@/lib/markdown/timestamps"

test("splits [m:ss] into a seek link node with seconds", () => {
  const parts = splitTimestamps("See [1:15] and [1:02:03] here")
  // text, link(75), text, link(3723), text
  expect(parts).toHaveLength(5)
  expect(parts![0]).toEqual({ type: "text", value: "See " })
  expect(parts![1]).toMatchObject({ type: "link", url: "#t=75" })
  expect(parts![3]).toMatchObject({ type: "link", url: "#t=3723" })
})

test("returns null when there is no timestamp", () => {
  expect(splitTimestamps("no timestamps here")).toBeNull()
})
