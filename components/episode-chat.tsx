"use client"

import { type ReactNode, useState } from "react"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatTimestamp, parseTimestamp } from "@/lib/format"

export type ChatSource = { episodeId: string; episodeTitle: string; startSec: number }

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

// Single source of truth for a chat. Omit episodeId to ask across the whole library.
export function useEpisodeChat(episodeId?: string) {
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState("")
  const [sources, setSources] = useState<ChatSource[]>([])
  const [busy, setBusy] = useState(false)

  async function ask() {
    setBusy(true)
    setAnswer("")
    setSources([])
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(episodeId ? { question, episodeId } : { question }),
      })
      if (!res.ok) throw new Error("Chat request failed")
      const header = res.headers.get("x-sources")
      if (header) {
        try {
          setSources(JSON.parse(decodeURIComponent(header)))
        } catch {
          /* ignore malformed sources */
        }
      }
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

  return { question, setQuestion, answer, sources, busy, ask }
}

export type EpisodeChatState = ReturnType<typeof useEpisodeChat>

// Presentational chat panel — stateless, driven by a shared useEpisodeChat() instance.
export function ChatPanel({
  chat,
  onSeek,
}: {
  chat: EpisodeChatState
  onSeek?: (sec: number) => void
}) {
  const { question, setQuestion, answer, sources, busy, ask } = chat
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What did they say about…?"
          onKeyDown={(e) => e.key === "Enter" && !busy && question && ask()}
        />
        <Button onClick={ask} disabled={busy || !question}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : "Ask"}
        </Button>
      </div>
      {answer && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{renderAnswer(answer, onSeek)}</p>
      )}
      {answer && sources.length > 0 && (
        <div className="space-y-1 border-t pt-2">
          <h3 className="text-xs font-medium text-muted-foreground">Sources</h3>
          <div className="flex flex-wrap gap-1.5">
            {sources.map((s, i) => (
              <Link
                key={i}
                href={`/episodes/${s.episodeId}?t=${s.startSec}`}
                className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                title={s.episodeTitle}
              >
                {s.episodeTitle.length > 28 ? `${s.episodeTitle.slice(0, 28)}…` : s.episodeTitle} ·{" "}
                {formatTimestamp(s.startSec)}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
