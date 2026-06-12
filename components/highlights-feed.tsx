"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Trash2 } from "lucide-react"
import { hiResArtwork } from "@/lib/artwork"
import { formatRelativeDate } from "@/lib/format"
import type { HighlightDTO } from "@/lib/api/highlight-dto"

const TYPES = [
  { key: "all", label: "All" },
  { key: "podcast", label: "Podcasts" },
  { key: "youtube", label: "Videos" },
  { key: "article", label: "Articles" },
  { key: "kindle", label: "Kindle" },
]

export function HighlightsFeed({ initial }: { initial: HighlightDTO[] }) {
  const router = useRouter()
  const [items, setItems] = useState(initial)
  const [type, setType] = useState("all")
  const [q, setQ] = useState("")

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    return items.filter(
      (h) =>
        (type === "all" || h.item.type === type) &&
        (!term || h.text.toLowerCase().includes(term) || (h.note ?? "").toLowerCase().includes(term)),
    )
  }, [items, type, q])

  async function remove(id: string) {
    setItems((xs) => xs.filter((h) => h.id !== id))
    await fetch(`/api/highlights/${id}`, { method: "DELETE" }).catch(() => {})
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setType(t.key)}
            className={
              "rounded-full border px-3 py-1 text-sm " +
              (type === t.key ? "bg-foreground text-background" : "hover:bg-muted")
            }
          >
            {t.label}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search highlights…"
          className="ml-auto rounded-lg border bg-background px-3 py-1.5 text-sm outline-none"
        />
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No highlights yet — select text in a transcript or insight to save one.</p>
      ) : (
        <ul className="space-y-3">
          {shown.map((h) => (
            <li key={h.id} className="group rounded-xl border p-4">
              <button
                type="button"
                onClick={() => router.push(h.jumpHref)}
                className="block w-full text-left font-serif text-lg leading-relaxed"
              >
                {h.text}
              </button>
              {h.note && <p className="mt-2 text-sm text-muted-foreground">{h.note}</p>}
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Link href={`/episodes/${h.item.id}`} className="flex min-w-0 items-center gap-2 hover:text-foreground">
                  <span className="size-6 shrink-0 overflow-hidden rounded bg-muted">
                    {h.item.artworkUrl ? (
                      <img src={hiResArtwork(h.item.artworkUrl, 60)} alt="" className="size-full object-cover" />
                    ) : null}
                  </span>
                  <span className="truncate">{h.item.title}</span>
                </Link>
                <span aria-hidden>·</span>
                <span className="capitalize">{h.item.type}</span>
                <span aria-hidden>·</span>
                <span>{formatRelativeDate(h.createdAt)}</span>
                <button
                  type="button"
                  onClick={() => remove(h.id)}
                  aria-label="Delete highlight"
                  className="ml-auto opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
