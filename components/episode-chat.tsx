"use client"

import { type ReactNode, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { parseTimestamp } from "@/lib/format"

// Render the streamed answer, turning [m:ss] / [h:mm:ss] citations into seek buttons.
function renderAnswer(text: string, onSeek?: (sec: number) => void): ReactNode[] {
  const re = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const ts = m[1]
    out.push(
      onSeek ? (
        <button
          key={key++}
          type="button"
          onClick={() => onSeek(parseTimestamp(ts))}
          className="font-sans text-primary hover:underline"
        >
          [{ts}]
        </button>
      ) : (
        `[${ts}]`
      ),
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function EpisodeChat({ episodeId, onSeek }: { episodeId: string; onSeek?: (sec: number) => void }) {
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
      if (!res.ok) throw new Error("Chat request failed")
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          setAnswer((prev) => prev + decoder.decode(value))
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Chat failed")
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
      {answer && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{renderAnswer(answer, onSeek)}</p>
      )}
    </div>
  )
}
