"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import type { InsightSection } from "@/components/episode-insights"

// Sticky "on this page" nav with scroll-spy. Observes the section anchors within
// the given scroll container and highlights the one currently at the top.
export function InsightsNav({
  sections,
  scrollRef,
}: {
  sections: InsightSection[]
  scrollRef: React.RefObject<HTMLDivElement | null>
}) {
  const [active, setActive] = useState(sections[0]?.id ?? "")
  const visible = useRef<Set<string>>(new Set())

  useEffect(() => {
    const root = scrollRef.current
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.current.add(e.target.id)
          else visible.current.delete(e.target.id)
        }
        // The topmost (first in render order) section in the trigger band wins.
        const first = sections.find((s) => visible.current.has(s.id))
        if (first) setActive(first.id)
      },
      { root, rootMargin: "-72px 0px -70% 0px", threshold: 0 },
    )
    for (const s of sections) {
      const el = document.getElementById(s.id)
      if (el) obs.observe(el)
    }
    return () => obs.disconnect()
  }, [sections, scrollRef])

  if (sections.length === 0) return null

  return (
    <nav className="sticky top-4 space-y-2.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">On this page</p>
      {sections.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() =>
            document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
          className={cn(
            "block w-full text-left text-sm leading-snug transition-colors",
            active === s.id ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {s.label}
        </button>
      ))}
    </nav>
  )
}
