"use client"

import type { ReactNode } from "react"
import type { HighlightKind } from "@/lib/highlights/locator"

/** Stamps the data attributes the selection layer reads. Wrap any highlightable
 *  region (transcript line, takeaway, quote). `sec`/`index` feed the locator. */
export function Highlightable({
  kind,
  sec,
  index,
  as: Tag = "div",
  className,
  children,
}: {
  kind: HighlightKind
  sec?: number
  index?: number
  as?: "div" | "p" | "li" | "span" | "blockquote"
  className?: string
  children: ReactNode
}) {
  return (
    <Tag
      data-hl-kind={kind}
      data-hl-sec={sec != null ? String(sec) : undefined}
      data-hl-index={index != null ? String(index) : undefined}
      className={className}
    >
      {children}
    </Tag>
  )
}
