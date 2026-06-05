import { expect, test } from "vitest"
import { parseItunesDuration } from "@/lib/rss/duration"

test("parses HH:MM:SS", () => {
  expect(parseItunesDuration("01:02:03")).toBe(3723)
})
test("parses MM:SS", () => {
  expect(parseItunesDuration("12:30")).toBe(750)
})
test("parses plain seconds", () => {
  expect(parseItunesDuration("1800")).toBe(1800)
})
test("returns undefined for junk", () => {
  expect(parseItunesDuration("")).toBeUndefined()
  expect(parseItunesDuration(undefined)).toBeUndefined()
})
