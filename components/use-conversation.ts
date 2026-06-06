"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { UIMessage } from "@/components/chat-message"

export function useConversation(conversationId: string | null) {
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!conversationId) {
      setMessages([])
      return
    }
    let active = true
    fetch(`/api/conversations/${conversationId}`)
      .then((r) => r.json())
      .then((d) => {
        if (active) setMessages(d.messages ?? [])
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [conversationId])

  const send = useCallback(
    async (content: string) => {
      if (!conversationId) return
      setBusy(true)
      setMessages((prev) => [...prev, { role: "user", content }, { role: "assistant", content: "" }])
      const ac = new AbortController()
      abortRef.current = ac
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId, content }),
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
              const lastMsg = next[next.length - 1]
              next[next.length - 1] = { ...lastMsg, content: lastMsg.content + chunk, sources }
              return next
            })
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") toast.error("Chat failed")
      } finally {
        setBusy(false)
        abortRef.current = null
      }
    },
    [conversationId],
  )

  const stop = useCallback(() => abortRef.current?.abort(), [])

  const regenerate = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user")
    if (!lastUser) return
    setMessages((prev) => {
      const idx = prev.map((m) => m.role).lastIndexOf("user")
      return prev.slice(0, idx + 1)
    })
    void send(lastUser.content)
  }, [messages, send])

  return { messages, busy, send, stop, regenerate }
}
