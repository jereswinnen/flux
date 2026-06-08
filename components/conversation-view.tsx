"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowDown, Loader2, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { ChatMessage } from "@/components/chat-message"
import { useStickToBottom } from "@/components/use-stick-to-bottom"
import type { useConversation } from "@/components/use-conversation"

export function ConversationView({
  chat,
  onSeek,
  emptyHint = "Ask a question to get started.",
  disabled = false,
}: {
  chat: ReturnType<typeof useConversation>
  onSeek?: (sec: number) => void
  emptyHint?: string
  disabled?: boolean
}) {
  const { messages, busy, send, stop } = chat
  const [draft, setDraft] = useState("")
  const taRef = useRef<HTMLTextAreaElement>(null)
  const { ref, atBottom, scrollToBottom, onScroll } = useStickToBottom(messages)

  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = "auto"
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`
  }, [draft])

  function submit() {
    const q = draft.trim()
    if (!q || busy || disabled) return
    setDraft("")
    void send(q)
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

      <div className="mx-auto w-full max-w-3xl space-y-2">
        {busy && (
          <button
            type="button"
            onClick={stop}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Square className="size-3" /> Stop
          </button>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            ref={taRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What did they say about…?"
            disabled={disabled}
            className="max-h-[200px] min-h-9 resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
          />
          <Button onClick={submit} disabled={busy || !draft.trim() || disabled}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Ask"}
          </Button>
        </div>
      </div>
    </div>
  )
}
