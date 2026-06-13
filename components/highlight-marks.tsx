"use client"

import { useEffect, useRef } from "react"
import { splitForMarks } from "@/lib/highlights/mark-text"

const MARK_CLASS =
  "rounded-[3px] bg-primary/15 hover:bg-primary/25 transition-colors cursor-pointer"

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
      const needle = m.text.trim()
      if (!needle) continue
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode() as Text | null
      while (node) {
        const idx = node.nodeValue?.indexOf(needle) ?? -1
        if (idx >= 0) {
          const range = document.createRange()
          range.setStart(node, idx)
          range.setEnd(node, idx + needle.length)
          const mark = document.createElement("mark")
          mark.setAttribute("data-hl-id", m.id)
          mark.className = MARK_CLASS
          try {
            range.surroundContents(mark)
          } catch {
            // Selection crossed an element boundary — skip this one.
          }
          break
        }
        node = walker.nextNode() as Text | null
      }
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
