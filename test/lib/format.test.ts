import { expect, test } from "vitest"
import { formatRelativeDate, formatTimestamp, parseTimestamp } from "@/lib/format"

const now = new Date("2026-06-05T12:00:00Z")

test("formatRelativeDate buckets recent dates", () => {
  expect(formatRelativeDate("2026-06-05T08:00:00Z", now)).toBe("today")
  expect(formatRelativeDate("2026-06-04T08:00:00Z", now)).toBe("yesterday")
  expect(formatRelativeDate("2026-06-01T12:00:00Z", now)).toBe("4 days ago")
  expect(formatRelativeDate("2026-05-20T12:00:00Z", now)).toBe("2w ago")
  expect(formatRelativeDate(null, now)).toBe("")
})

test("formatTimestamp still works (unchanged)", () => {
  expect(formatTimestamp(75)).toBe("1:15")
})

test("parseTimestamp is the inverse of formatTimestamp", () => {
  expect(parseTimestamp("1:15")).toBe(75)
  expect(parseTimestamp("0:05")).toBe(5)
  expect(parseTimestamp("1:02:03")).toBe(3723)
  expect(parseTimestamp(" 12:30 ")).toBe(750)
  expect(parseTimestamp("bad")).toBe(0)
})
