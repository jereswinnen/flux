"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowDown, ArrowUp, Square, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ChatMessage } from "@/components/chat-message"
import { usePlayer } from "@/components/player-context"
import { useVideoPlayer } from "@/components/video-player"
import { useStickToBottom } from "@/components/use-stick-to-bottom"
import { hiResArtwork } from "@/lib/artwork"
import { cn } from "@/lib/utils"
import type { useConversation } from "@/components/use-conversation"

export type AttachableItem = {
  id: string
  title: string
  podcastName?: string | null
  artworkUrl?: string | null
  audioUrl?: string | null
  videoId?: string | null
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
  episodes?: AttachableItem[]
  initialAttachment?: AttachableItem | null
}) {
  const { messages, busy, send, stop } = chat
  const audio = usePlayer()
  const video = useVideoPlayer()
  const [draft, setDraft] = useState("")
  const [attached, setAttached] = useState<AttachableItem | null>(
    initialAttachment
  )
  const [prevAttachId, setPrevAttachId] = useState(
    initialAttachment?.id ?? null
  )
  const [mention, setMention] = useState<string | null>(null) // active @query, or null
  const [highlight, setHighlight] = useState(0)
  // Keep the bar mounted (with its last content) through its exit animation.
  const [barRendered, setBarRendered] = useState(!!attached)
  const [shownAttachment, setShownAttachment] = useState(attached)
  const [prevBarKey, setPrevBarKey] = useState(attached?.id ?? null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Sync the attachment when the deep-linked episode (?attach=) resolves — done
  // during render (not in an effect) to avoid cascading re-renders.
  if ((initialAttachment?.id ?? null) !== prevAttachId) {
    setPrevAttachId(initialAttachment?.id ?? null)
    if (initialAttachment) setAttached(initialAttachment)
  }
  // On (re)attach, mount the bar and capture the content to display while it's open.
  if ((attached?.id ?? null) !== prevBarKey) {
    setPrevBarKey(attached?.id ?? null)
    if (attached) {
      setShownAttachment(attached)
      setBarRendered(true)
    }
  }
  // After detaching, unmount the bar once its exit animation has played.
  useEffect(() => {
    if (!attached && barRendered) {
      const t = setTimeout(() => setBarRendered(false), 200)
      return () => clearTimeout(t)
    }
  }, [attached, barRendered])

  const { ref, atBottom, scrollToBottom, onScroll } = useStickToBottom(messages)

  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = "auto"
    ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`
  }, [draft])

  // Focus the composer when an episode is pre-attached from the episode detail button.
  useEffect(() => {
    if (initialAttachment) taRef.current?.focus()
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

  function onDraftChange(value: string) {
    setDraft(value)
    // Detect a trailing "@query" token to drive the episode picker.
    const m = value.match(/(?:^|\s)@([^\s@]*)$/)
    setMention(m && episodes.length > 0 ? m[1] : null)
    setHighlight(0)
  }

  function attachEpisode(e: AttachableItem) {
    setAttached(e)
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
      <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-6">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">{emptyHint}</p>
          ) : (
            messages.map((m, i) => {
              const isLast = i === messages.length - 1
              return (
                <ChatMessage
                  key={m.id ?? i}
                  message={m}
                  onSeek={(sec) => {
                    // Inline [m:ss] timestamps refer to the attached item — cue it
                    // in place (video mini / audio bar).
                    if (attached?.videoId) {
                      video.cue(attached.videoId, {
                        startSec: Math.floor(sec),
                        itemId: attached.id,
                        title: attached.title,
                      })
                    } else if (attached?.audioUrl) {
                      audio.cue(
                        {
                          itemId: attached.id,
                          audioUrl: attached.audioUrl,
                          title: attached.title,
                          artworkUrl: attached.artworkUrl ?? null,
                          markers: [],
                        },
                        Math.floor(sec),
                      )
                    } else {
                      onSeek?.(sec)
                    }
                  }}
                  pending={isLast && m.role === "assistant" && busy}
                />
              )
            })
          )}
        </div>
      </div>

      {!atBottom && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={scrollToBottom}
          >
            <ArrowDown className="size-3.5" /> Jump to latest
          </Button>
        </div>
      )}

      <div className="mx-auto w-full max-w-3xl">
        <div className="relative">
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
                  <div className="size-5 shrink-0 overflow-hidden rounded bg-muted">
                    {e.artworkUrl ? (
                      <img
                        src={hiResArtwork(e.artworkUrl, 80)}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : null}
                  </div>
                  <span className="truncate">{e.title}</span>
                </button>
              ))}
            </div>
          )}

          {barRendered && shownAttachment && (
            <div
              className={cn(
                "flex items-center gap-2 rounded-t-2xl bg-muted px-3 pb-5 pt-2 duration-200",
                attached
                  ? "animate-in fade-in slide-in-from-bottom-2"
                  : "animate-out fade-out slide-out-to-bottom-2",
              )}
            >
              <div className="size-4 shrink-0 overflow-hidden rounded bg-background">
                {shownAttachment.artworkUrl ? (
                  <img src={hiResArtwork(shownAttachment.artworkUrl, 80)} alt="" className="size-full object-cover" />
                ) : null}
              </div>
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{shownAttachment.title}</span>
              <button
                type="button"
                aria-label="Detach episode"
                onClick={() => setAttached(null)}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}
          <div className="relative flex items-end gap-2 rounded-2xl border border-foreground/15 bg-background py-2 pr-2 pl-3 shadow-sm transition-[border-color,box-shadow] focus-within:border-transparent focus-within:ring-2 focus-within:ring-teal-500 focus-within:ring-offset-1 data-[attached=true]:-mt-3" data-attached={barRendered ? "true" : "false"}>
              <Textarea
                ref={taRef}
                rows={1}
                value={draft}
                onChange={(e) => onDraftChange(e.target.value)}
                placeholder={attached ? "Ask about this episode…" : "Ask anything…  (type @ to attach an episode)"}
                disabled={disabled}
                className="max-h-55 min-h-7 flex-1 resize-none border-0 bg-transparent p-0 py-1 text-base leading-7 shadow-none focus-visible:ring-0 dark:bg-transparent"
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
                  // Backspace on an empty input detaches the attached episode.
                  if (e.key === "Backspace" && draft.length === 0 && attached) {
                    e.preventDefault()
                    setAttached(null)
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
                <Button size="icon" onClick={stop} aria-label="Stop" className="size-8 shrink-0 rounded-full">
                  <Square className="size-4 fill-current" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  onClick={submit}
                  disabled={!draft.trim() || disabled}
                  aria-label="Send"
                  className="size-8 shrink-0 rounded-full"
                >
                  <ArrowUp className="size-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
    </div>
  )
}
