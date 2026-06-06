"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowDown, Loader2, RefreshCw, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ChatMessage, type UIMessage } from "@/components/chat-message"
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
  const { messages, busy, send, stop, regenerate, editAndResend } = chat
  const [draft, setDraft] = useState("")
  const [editing, setEditing] = useState<{ id: string } | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const { ref, atBottom, scrollToBottom, onScroll } = useStickToBottom(messages)

  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = "auto"
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`
  }, [draft])

  const lastUserId = [...messages].reverse().find((m) => m.role === "user")?.id

  function submit() {
    const q = draft.trim()
    if (!q || busy || disabled) return
    setDraft("")
    if (editing) {
      void editAndResend(editing.id, q)
      setEditing(null)
    } else {
      void send(q)
    }
  }

  function startEdit(m: UIMessage) {
    if (!m.id) return
    setEditing({ id: m.id })
    setDraft(m.content)
    taRef.current?.focus()
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div ref={ref} onScroll={onScroll} className="relative flex-1 space-y-4 overflow-y-auto">
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
                onEdit={
                  (m.role === "user" && !!m.id && m.id === lastUserId && !busy)
                    ? startEdit
                    : undefined
                }
              />
            )
          })
        )}
      </div>

      {!atBottom && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" className="gap-1" onClick={scrollToBottom}>
            <ArrowDown className="size-3.5" /> Jump to latest
          </Button>
        </div>
      )}

      <div className="space-y-2">
        {messages.some((m) => m.role === "assistant") && (
          <div className="flex gap-3">
            {busy ? (
              <button
                type="button"
                onClick={stop}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Square className="size-3" /> Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={regenerate}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className="size-3" /> Regenerate
              </button>
            )}
          </div>
        )}
        {editing && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Editing your message…</span>
            <button
              type="button"
              onClick={() => {
                setEditing(null)
                setDraft("")
              }}
              className="hover:text-foreground"
            >
              Cancel
            </button>
          </div>
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
