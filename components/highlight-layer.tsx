"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { buildLocator, type HighlightKind } from "@/lib/highlights/locator"
import { useHighlights } from "@/components/highlights-context"

type Pending = { x: number; y: number; kind: HighlightKind; text: string; data: Record<string, string | undefined> }

/** Mounted once on a detail view. Watches for a text selection that lands inside a
 *  [data-hl-kind] region and offers a floating "Highlight" button that POSTs it. */
export function HighlightLayer({ itemId }: { itemId: string }) {
  const { add } = useHighlights()
  const [pending, setPending] = useState<Pending | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    function compute() {
      const sel = window.getSelection()
      const text = sel?.toString().trim() ?? ""
      if (!sel || sel.rangeCount === 0 || !text) {
        setPending(null)
        return
      }
      const node = sel.anchorNode
      const el = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>("[data-hl-kind]")
      if (!el) {
        setPending(null)
        return
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      setPending({
        x: rect.left + rect.width / 2,
        y: rect.top,
        kind: (el.dataset.hlKind as HighlightKind) ?? "transcript",
        text,
        data: { hlSec: el.dataset.hlSec, hlIndex: el.dataset.hlIndex },
      })
    }
    function onSelectionChange() {
      clearTimeout(timer)
      timer = setTimeout(compute, 350)
    }
    document.addEventListener("mouseup", compute)
    document.addEventListener("selectionchange", onSelectionChange)
    return () => {
      clearTimeout(timer)
      document.removeEventListener("mouseup", compute)
      document.removeEventListener("selectionchange", onSelectionChange)
    }
  }, [])

  async function save() {
    if (!pending) return
    const body = {
      itemId,
      kind: pending.kind,
      text: pending.text,
      locator: buildLocator(pending.kind, pending.data),
    }
    setPending(null)
    window.getSelection()?.removeAllRanges()
    try {
      const res = await fetch("/api/highlights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      const { highlight } = await res.json()
      add({
        id: highlight.id,
        kind: highlight.kind,
        text: highlight.text,
        note: highlight.note ?? null,
        locator: highlight.locator ?? null,
      })
      toast.success("Highlighted")
    } catch {
      toast.error("Couldn't save highlight")
    }
  }

  if (!pending) return null
  return (
    <div
      ref={barRef}
      style={{ left: pending.x, top: Math.max(8, pending.y - 44) }}
      className="fixed z-50 -translate-x-1/2"
      onMouseDown={(e) => e.preventDefault()} // keep the selection while clicking
      onPointerDown={(e) => e.preventDefault()} // covers touch events on iOS
    >
      <button
        type="button"
        onClick={save}
        className="rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background shadow-lg"
      >
        Highlight
      </button>
    </div>
  )
}
