"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { UIMessage } from "@/components/chat-message"

export function useConversation(conversationId: string | null) {
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const reload = useCallback(async () => {
    if (!conversationId) return
    try {
      const d = await fetch(`/api/conversations/${conversationId}`).then((r) => r.json())
      setMessages(d.messages ?? [])
    } catch {
      /* ignore */
    }
  }, [conversationId])

  // After a stream, the assistant turn is persisted in the route's onFinish (after the
  // stream closes), so a quick GET can miss it. Poll briefly until it lands, then adopt
  // the canonical messages (with ids); otherwise keep the streamed optimistic content.
  const syncAfterStream = useCallback(async () => {
    if (!conversationId) return
    for (let i = 0; i < 4; i++) {
      try {
        const d = await fetch(`/api/conversations/${conversationId}`).then((r) => r.json())
        const server: UIMessage[] = d.messages ?? []
        const last = server[server.length - 1]
        if (last && last.role === "assistant" && last.content) {
          setMessages(server)
          return
        }
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 400))
    }
  }, [conversationId])

  useEffect(() => {
    if (!conversationId) {
      setMessages([])
      return
    }
    void reload()
  }, [conversationId, reload])

  const runStream = useCallback(
    async (payload: Record<string, unknown>, optimistic: (prev: UIMessage[]) => UIMessage[]) => {
      if (!conversationId) return
      setBusy(true)
      setMessages(optimistic)
      const ac = new AbortController()
      abortRef.current = ac
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId, ...payload }),
          signal: ac.signal,
        })
        if (!res.ok) throw new Error("Chat failed")
        let sources: UIMessage["sources"] = null
        const header = res.headers.get("x-sources")
        if (header) {
          try {
            sources = JSON.parse(decodeURIComponent(header))
          } catch {
            /* ignore */
          }
        }
        const reader = res.body?.getReader()
        const decoder = new TextDecoder()
        if (reader) {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            const chunk = decoder.decode(value)
            setMessages((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              next[next.length - 1] = { ...last, content: last.content + chunk, sources }
              return next
            })
          }
        }
        await syncAfterStream()
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          // Stopped by the user — keep the streamed-so-far optimistic content.
        } else {
          toast.error("Chat failed")
          await reload()
        }
      } finally {
        setBusy(false)
        abortRef.current = null
      }
    },
    [conversationId, reload, syncAfterStream],
  )

  const send = useCallback(
    (content: string) =>
      runStream({ content }, (prev) => [
        ...prev,
        { role: "user", content },
        { role: "assistant", content: "" },
      ]),
    [runStream],
  )

  const regenerate = useCallback(
    () =>
      runStream({ regenerate: true }, (prev) => {
        const idx = prev.map((m) => m.role).lastIndexOf("assistant")
        const trimmed = idx >= 0 ? prev.slice(0, idx) : prev
        return [...trimmed, { role: "assistant", content: "" }]
      }),
    [runStream],
  )

  const editAndResend = useCallback(
    (messageId: string, content: string) =>
      runStream({ editFromMessageId: messageId, content }, (prev) => {
        const idx = prev.findIndex((m) => m.id === messageId)
        const trimmed = idx >= 0 ? prev.slice(0, idx) : prev
        return [...trimmed, { role: "user", content }, { role: "assistant", content: "" }]
      }),
    [runStream],
  )

  const stop = useCallback(() => abortRef.current?.abort(), [])

  return { messages, busy, send, stop, regenerate, editAndResend }
}
