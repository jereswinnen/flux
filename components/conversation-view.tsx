"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowDown, ArrowUp, AtSign, Square, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { ChatMessage } from "@/components/chat-message"
import { useStickToBottom } from "@/components/use-stick-to-bottom"
import { hiResArtwork } from "@/lib/artwork"
import type { useConversation } from "@/components/use-conversation"

export type AttachableEpisode = {
  id: string
  title: string
  podcastName?: string | null
  artworkUrl?: string | null
}

export function ConversationView({
  chat,
  onSeek,
  emptyHint = "Ask a question to get started.",
  disabled = false,
  episodes = [],
  initialAttachment = null,
}: {
  chat: ReturnType<typeof useConversation>
  onSeek?: (sec: number) => void
  emptyHint?: string
  disabled?: boolean
  episodes?: AttachableEpisode[]
  initialAttachment?: AttachableEpisode | null
}) {
  const { messages, busy, send, stop } = chat
  const [draft, setDraft] = useState("")
  const [attached, setAttached] = useState<AttachableEpisode | null>(null)
  const [mention, setMention] = useState<string | null>(null) // active @query, or null
  const [highlight, setHighlight] = useState(0)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const { ref, atBottom, scrollToBottom, onScroll } = useStickToBottom(messages)

  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = "auto"
    ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`
  }, [draft])

  // Pre-attach an episode when arriving from the episode detail "Ask" button.
  useEffect(() => {
    if (initialAttachment) {
      setAttached(initialAttachment)
      taRef.current?.focus()
    }
  }, [initialAttachment?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Match against both the episode title and the show (podcast) title.
  const matches =
    mention !== null
      ? episodes
          .filter((e) => {
            const q = mention.toLowerCase().trim()
            return (
              !q ||
              e.title.toLowerCase().includes(q) ||
              (e.podcastName ?? "").toLowerCase().includes(q)
            )
          })
          .slice(0, 6)
      : []

  // Keep the keyboard highlight in range as the query narrows.
  useEffect(() => {
    setHighlight(0)
  }, [mention])

  function onDraftChange(value: string) {
    setDraft(value)
    // Detect a trailing "@query" token to drive the episode picker.
    const m = value.match(/(?:^|\s)@([^\s@]*)$/)
    setMention(m && episodes.length > 0 ? m[1] : null)
  }

  function attachEpisode(e: AttachableEpisode) {
    setAttached({ id: e.id, title: e.title })
    setDraft((d) => d.replace(/@[^\s@]*$/, "").replace(/\s+$/, ""))
    setMention(null)
    taRef.current?.focus()
  }

  function submit() {
    const q = draft.trim()
    if (!q || busy || disabled) return
    setDraft("")
    setMention(null)
    void send(q, attached?.id) // attachment stays "sticky" for follow-ups
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <ScrollArea className="min-h-0 flex-1" viewportRef={ref} viewportProps={{ onScroll }}>
        <div className="mx-auto w-full max-w-3xl space-y-6 pr-3">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">{emptyHint}</p>
          ) : (
            messages.map((m, i) => {
              const isLast = i === messages.length - 1
              return (
                <ChatMessage
                  key={m.id ?? i}
                  message={m}
                  onSeek={onSeek}
                  pending={isLast && m.role === "assistant" && busy}
                />
              )
            })
          )}
        </div>
      </ScrollArea>

      {!atBottom && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" className="gap-1" onClick={scrollToBottom}>
            <ArrowDown className="size-3.5" /> Jump to latest
          </Button>
        </div>
      )}

      <div className="mx-auto w-full max-w-3xl">
        <div className="relative rounded-2xl border bg-background shadow-sm transition-colors focus-within:border-foreground/20 focus-within:ring-1 focus-within:ring-ring/30">
          {/* @-mention episode picker — styled like the sidebar nav */}
          {mention !== null && matches.length > 0 && (
            <div className="absolute bottom-full left-0 z-20 mb-2 w-72 max-w-full overflow-hidden rounded-xl border bg-popover p-1 shadow-md">
              {matches.map((e, idx) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => attachEpisode(e)}
                  onMouseEnter={() => setHighlight(idx)}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm ${
                    idx === highlight ? "bg-accent text-accent-foreground" : ""
                  }`}
                >
                  <div className="size-7 shrink-0 overflow-hidden rounded-md bg-muted">
                    {e.artworkUrl ? (
                      <img src={hiResArtwork(e.artworkUrl, 80)} alt="" className="size-full object-cover" />
                    ) : null}
                  </div>
                  <span className="truncate">{e.title}</span>
                </button>
              ))}
            </div>
          )}

          {attached && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-3">
              <span className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-primary/10 py-1 pl-2 pr-1 text-xs font-medium text-primary">
                <AtSign className="size-3 shrink-0" />
                <span className="truncate">{attached.title}</span>
                <button
                  type="button"
                  aria-label="Detach episode"
                  onClick={() => setAttached(null)}
                  className="shrink-0 rounded p-0.5 hover:bg-primary/15"
                >
                  <X className="size-3" />
                </button>
              </span>
            </div>
          )}

          <Textarea
            ref={taRef}
            rows={1}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder={attached ? "Ask about this episode…" : "Ask anything…  (type @ to attach an episode)"}
            disabled={disabled}
            className="max-h-[220px] min-h-[52px] resize-none border-0 bg-transparent px-4 py-3.5 pr-14 text-base shadow-none focus-visible:ring-0 dark:bg-transparent"
            onKeyDown={(e) => {
              const picking = mention !== null && matches.length > 0
              if (picking && e.key === "ArrowDown") {
                e.preventDefault()
                setHighlight((h) => (h + 1) % matches.length)
                return
              }
              if (picking && e.key === "ArrowUp") {
                e.preventDefault()
                setHighlight((h) => (h - 1 + matches.length) % matches.length)
                return
              }
              if (e.key === "Escape" && mention !== null) {
                setMention(null)
                return
              }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                if (picking) attachEpisode(matches[highlight] ?? matches[0])
                else submit()
              }
            }}
          />
          {busy ? (
            <Button
              size="icon"
              onClick={stop}
              aria-label="Stop"
              className="absolute bottom-2.5 right-2.5 size-9 rounded-full"
            >
              <Square className="size-4 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={submit}
              disabled={!draft.trim() || disabled}
              aria-label="Send"
              className="absolute bottom-2.5 right-2.5 size-9 rounded-full"
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
