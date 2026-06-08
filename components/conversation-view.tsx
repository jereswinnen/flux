"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowDown, ArrowUp, Square } from "lucide-react"
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

      <div className="mx-auto w-full max-w-3xl">
        <div className="relative rounded-2xl border bg-background shadow-sm transition-colors focus-within:border-foreground/20 focus-within:ring-1 focus-within:ring-ring/30">
          <Textarea
            ref={taRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask anything…"
            disabled={disabled}
            className="max-h-[220px] min-h-[52px] resize-none border-0 bg-transparent px-4 py-3.5 pr-14 text-base shadow-none focus-visible:ring-0 dark:bg-transparent"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
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
