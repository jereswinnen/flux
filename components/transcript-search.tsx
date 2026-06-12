"use client"

import { useMemo, useState, type ReactNode } from "react"
import { ChevronDown, ChevronUp, Search, X } from "lucide-react"

/**
 * Shared transcript search: given the per-segment texts, tracks the query, the
 * list of matching segment indices, and a cursor for next/prev navigation.
 * Used by both the podcast (static) and YouTube (live) transcripts.
 */
export function useTranscriptSearch(texts: string[]) {
  const [query, setQueryRaw] = useState("")
  const [pos, setPos] = useState(0)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return [] as number[]
    const out: number[] = []
    texts.forEach((t, i) => {
      if (t.toLowerCase().includes(q)) out.push(i)
    })
    return out
  }, [texts, query])

  const activePos = matches.length ? Math.min(pos, matches.length - 1) : -1
  const current = activePos >= 0 ? matches[activePos] : -1

  return {
    query,
    setQuery: (v: string) => {
      setQueryRaw(v)
      setPos(0)
    },
    matches,
    /** Set of matching segment indices, for quick membership checks. */
    matchSet: useMemo(() => new Set(matches), [matches]),
    /** Index (into matches) of the current match, or -1. */
    activePos,
    /** The segment index of the current match, or -1. */
    current,
    total: matches.length,
    next: () => matches.length && setPos((p) => (p + 1) % matches.length),
    prev: () => matches.length && setPos((p) => (p - 1 + matches.length) % matches.length),
  }
}

export type TranscriptSearch = ReturnType<typeof useTranscriptSearch>

export function TranscriptSearchBar({
  search,
  className,
}: {
  search: TranscriptSearch
  className?: string
}) {
  const { query, setQuery, total, activePos, next, prev } = search
  return (
    <div
      className={
        "flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5 " + (className ?? "")
      }
    >
      <Search className="size-4 shrink-0 text-muted-foreground" />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            if (e.shiftKey) prev()
            else next()
          }
        }}
        placeholder="Search transcript…"
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      {query.trim() !== "" && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {total ? `${activePos + 1}/${total}` : "0/0"}
        </span>
      )}
      <button
        type="button"
        onClick={prev}
        disabled={!total}
        aria-label="Previous match"
        className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
      >
        <ChevronUp className="size-4" />
      </button>
      <button
        type="button"
        onClick={next}
        disabled={!total}
        aria-label="Next match"
        className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
      >
        <ChevronDown className="size-4" />
      </button>
      {query.trim() !== "" && (
        <button
          type="button"
          onClick={() => setQuery("")}
          aria-label="Clear search"
          className="rounded p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}

/** Render `text` with case-insensitive occurrences of `query` wrapped in <mark>. */
export function highlightQuery(text: string, query: string): ReactNode {
  const q = query.trim()
  if (!q) return text
  const lower = text.toLowerCase()
  const ql = q.toLowerCase()
  const parts: ReactNode[] = []
  let i = 0
  let key = 0
  let idx = lower.indexOf(ql)
  if (idx === -1) return text
  while (idx !== -1) {
    if (idx > i) parts.push(text.slice(i, idx))
    parts.push(
      <mark key={key++} className="rounded bg-yellow-300/60 text-foreground">
        {text.slice(idx, idx + q.length)}
      </mark>,
    )
    i = idx + q.length
    idx = lower.indexOf(ql, i)
  }
  if (i < text.length) parts.push(text.slice(i))
  return parts
}
