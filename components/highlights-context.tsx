"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"
import type { HighlightLocator } from "@/lib/highlights/locator"

export type InlineHighlight = {
  id: string
  kind: string
  text: string
  note: string | null
  locator: HighlightLocator | null
}

type Ctx = {
  highlights: InlineHighlight[]
  add: (h: InlineHighlight) => void
  remove: (id: string) => Promise<void>
  openMark: (id: string, rect: DOMRect) => void
}

const HighlightsContext = createContext<Ctx | null>(null)

/** Throws if no provider — use in surfaces always rendered inside the detail view. */
export function useHighlights(): Ctx {
  const c = useContext(HighlightsContext)
  if (!c) throw new Error("useHighlights must be used within HighlightsProvider")
  return c
}

/** Returns null when there's no provider — for shared surfaces that may render
 *  outside a detail view (they fall back to plain, unmarked text). */
export function useHighlightsOptional(): Ctx | null {
  return useContext(HighlightsContext)
}

export function HighlightsProvider({
  initial,
  children,
}: {
  initial: InlineHighlight[]
  children: ReactNode
}) {
  const [highlights, setHighlights] = useState<InlineHighlight[]>(initial)
  const [active, setActive] = useState<{ id: string; rect: DOMRect } | null>(null)

  const add = useCallback((h: InlineHighlight) => {
    setHighlights((xs) => (xs.some((x) => x.id === h.id) ? xs : [h, ...xs]))
  }, [])

  const remove = useCallback(async (id: string) => {
    setActive(null)
    let rolledBack: InlineHighlight[] = []
    setHighlights((xs) => {
      rolledBack = xs
      return xs.filter((x) => x.id !== id)
    })
    try {
      const res = await fetch(`/api/highlights/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
    } catch {
      setHighlights(rolledBack)
      toast.error("Couldn't remove highlight")
    }
  }, [])

  const openMark = useCallback((id: string, rect: DOMRect) => setActive({ id, rect }), [])

  const value = useMemo(() => ({ highlights, add, remove, openMark }), [highlights, add, remove, openMark])
  const activeHl = active ? highlights.find((h) => h.id === active.id) ?? null : null

  return (
    <HighlightsContext.Provider value={value}>
      {children}
      {active && activeHl && (
        <RemovePopover
          rect={active.rect}
          note={activeHl.note}
          onRemove={() => void remove(active.id)}
          onClose={() => setActive(null)}
        />
      )}
    </HighlightsContext.Provider>
  )
}

function RemovePopover({
  rect,
  note,
  onRemove,
  onClose,
}: {
  rect: DOMRect
  note: string | null
  onRemove: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    // Defer so the opening click doesn't immediately close it.
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener("mousedown", onDown)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      style={{ left: rect.left + rect.width / 2, top: Math.max(8, rect.top - 8) }}
      className="fixed z-50 -translate-x-1/2 -translate-y-full rounded-xl border bg-popover p-3 text-sm shadow-md"
    >
      {note && <p className="mb-2 max-w-60 text-muted-foreground">{note}</p>}
      <button
        type="button"
        onClick={onRemove}
        className="font-medium text-destructive hover:underline"
      >
        Remove highlight
      </button>
    </div>
  )
}
