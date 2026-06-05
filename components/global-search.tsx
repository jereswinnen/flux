"use client"

import Link from "next/link"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { formatTimestamp } from "@/lib/format"

type Hit = {
  chunkId: string
  episodeId: string
  episodeTitle: string
  content: string
  startSec: number
  endSec: number
  similarity: number
}

export function GlobalSearch() {
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<Hit[]>([])
  const [busy, setBusy] = useState(false)

  async function search() {
    setBusy(true)
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q }),
      })
      setHits((await res.json()).hits)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search across all episodes…" />
        <Button onClick={search} disabled={busy || !q}>Search</Button>
      </div>
      {hits.map((h) => (
        <Link key={h.chunkId} href={`/episodes/${h.episodeId}`}>
          <Card className="space-y-1 p-3 hover:bg-accent">
            <div className="text-muted-foreground text-xs">
              {h.episodeTitle} · [{formatTimestamp(h.startSec)}]
            </div>
            <p className="text-sm">{h.content}</p>
          </Card>
        </Link>
      ))}
    </div>
  )
}
