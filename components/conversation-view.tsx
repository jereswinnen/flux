"use client"

import { useState } from "react"
import { Loader2, RefreshCw, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ChatMessage } from "@/components/chat-message"
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
  const { messages, busy, send, stop, regenerate } = chat
  const [draft, setDraft] = useState("")

  function submit() {
    const q = draft.trim()
    if (!q || busy || disabled) return
    setDraft("")
    void send(q)
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex-1 space-y-4 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyHint}</p>
        ) : (
          messages.map((m, i) => <ChatMessage key={i} message={m} onSeek={onSeek} />)
        )}
      </div>

      <div className="space-y-2">
        {messages.some((m) => m.role === "assistant") && (
          <div className="flex gap-3">
            {busy ? (
              <button type="button" onClick={stop} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <Square className="size-3" /> Stop
              </button>
            ) : (
              <button type="button" onClick={regenerate} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <RefreshCw className="size-3" /> Regenerate
              </button>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What did they say about…?"
            disabled={disabled}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <Button onClick={submit} disabled={busy || !draft.trim() || disabled}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Ask"}
          </Button>
        </div>
      </div>
    </div>
  )
}
