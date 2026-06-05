"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function EpisodeChat({ episodeId }: { episodeId: string }) {
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState("")
  const [busy, setBusy] = useState(false)

  async function ask() {
    setBusy(true)
    setAnswer("")
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, episodeId }),
      })
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          setAnswer((prev) => prev + decoder.decode(value))
        }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What did they say about…?"
          onKeyDown={(e) => e.key === "Enter" && !busy && question && ask()}
        />
        <Button onClick={ask} disabled={busy || !question}>Ask</Button>
      </div>
      {answer && <p className="whitespace-pre-wrap text-sm leading-relaxed">{answer}</p>}
    </div>
  )
}
