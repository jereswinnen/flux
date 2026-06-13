"use client"

import { useEffect, useRef } from "react"
import { splitForMarks } from "@/lib/highlights/mark-text"

const MARK_CLASS =
  "rounded-[3px] bg-primary/15 hover:bg-primary/25 transition-colors cursor-pointer"

/** Wrap the first occurrence of `needle` in `root` in `<mark data-hl-id>`, even
 *  when it spans multiple text nodes (a sentence crossing a <a>/<strong>). Each
 *  intersecting text-node portion gets its own <mark> (sharing the id), so a
 *  click anywhere in the span opens the popover. Text already inside a mark is
 *  skipped, so overlapping highlights resolve first-wins and never nest. */
function markRange(root: HTMLElement, needle: string, id: string) {
  if (!needle) return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      (n.parentElement as HTMLElement | null)?.closest("mark[data-hl-id]")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  })
  let full = ""
  const spans: { node: Text; start: number }[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text
    spans.push({ node, start: full.length })
    full += node.nodeValue ?? ""
  }

  const at = full.indexOf(needle)
  if (at < 0) return
  const end = at + needle.length

  // Collect the covered portion of each intersecting text node up front (offsets
  // are computed before any DOM mutation; distinct nodes don't affect each other).
  const hits: { node: Text; from: number; to: number }[] = []
  for (const { node, start } of spans) {
    const len = node.nodeValue?.length ?? 0
    const nodeEnd = start + len
    if (nodeEnd <= at || start >= end) continue
    hits.push({ node, from: Math.max(0, at - start), to: Math.min(len, end - start) })
  }

  for (const { node, from, to } of hits) {
    if (to <= from) continue
    const range = document.createRange()
    range.setStart(node, from)
    range.setEnd(node, to)
    const mark = document.createElement("mark")
    mark.setAttribute("data-hl-id", id)
    mark.className = MARK_CLASS
    // Single-node range — surroundContents never throws here.
    range.surroundContents(mark)
  }
}

/** Render a plain string with saved highlights wrapped in clickable <mark>s.
 *  For React-controlled text (insights takeaways/quotes). */
export function MarkedText({
  text,
  marks,
  onMarkClick,
}: {
  text: string
  marks: { id: string; text: string }[]
  onMarkClick: (id: string, rect: DOMRect) => void
}) {
  const segments = splitForMarks(text, marks)
  return (
    <>
      {segments.map((s, i) =>
        s.id ? (
          <mark
            key={i}
            data-hl-id={s.id}
            className={MARK_CLASS}
            onClick={(e) => onMarkClick(s.id!, e.currentTarget.getBoundingClientRect())}
          >
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  )
}

/** Render sanitized article HTML, then wrap the first single-text-node occurrence
 *  of each highlight snapshot in a clickable <mark>. The subtree is uncontrolled
 *  (set via innerHTML), so direct DOM mutation is safe. */
export function HighlightedHtml({
  html,
  marks,
  onMarkClick,
  className,
}: {
  html: string
  marks: { id: string; text: string }[]
  onMarkClick: (id: string, rect: DOMRect) => void
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    root.innerHTML = html
    for (const m of marks) {
      markRange(root, m.text.trim(), m.id)
    }
  }, [html, marks])

  useEffect(() => {
    const root = ref.current
    if (!root) return
    function onClick(e: MouseEvent) {
      const mark = (e.target as HTMLElement)?.closest?.("mark[data-hl-id]") as HTMLElement | null
      if (mark) onMarkClick(mark.getAttribute("data-hl-id")!, mark.getBoundingClientRect())
    }
    root.addEventListener("click", onClick)
    return () => root.removeEventListener("click", onClick)
  }, [onMarkClick])

  // Render the (server-sanitized) HTML directly so the article body is in the
  // initial SSR payload; the effect above re-applies it and wraps marks on the
  // client. Content is pre-sanitized server-side via sanitize-html.
  return (
    <div
      ref={ref}
      data-hl-kind="article"
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
