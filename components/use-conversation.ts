"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { UIMessage } from "@/components/chat-message"

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

export function useConversation(
  conversationId: string | null,
  opts: { onStreamEnd?: () => void } = {},
) {
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  // Keep the latest callback without making it a stream dependency.
  const onStreamEndRef = useRef(opts.onStreamEnd)
  onStreamEndRef.current = opts.onStreamEnd

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
        let buffer = ""
        const webSources: NonNullable<UIMessage["sources"]> = []
        const titleById = new Map<string, string>()

        const mergedSources = (): UIMessage["sources"] => [
          ...(sources ?? []),
          ...webSources,
        ]
        const patchLast = (patch: Partial<UIMessage>) =>
          setMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            next[next.length - 1] = { ...last, ...patch }
            return next
          })

        if (reader) {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() ?? ""
            for (const line of lines) {
              const t = line.trim()
              if (!t.startsWith("data:")) continue
              const data = t.slice(5).trim()
              if (!data || data === "[DONE]") continue
              let part: Record<string, unknown>
              try {
                part = JSON.parse(data)
              } catch {
                continue
              }
              const type = part.type as string
              if (type === "text-delta" && typeof part.delta === "string") {
                const delta = part.delta as string
                setMessages((prev) => {
                  const next = [...prev]
                  const last = next[next.length - 1]
                  next[next.length - 1] = {
                    ...last,
                    content: last.content + delta,
                    status: null,
                    sources: mergedSources(),
                  }
                  return next
                })
              } else if (type === "tool-input-available" && part.toolName === "web_search") {
                const input = part.input as { query?: string } | undefined
                patchLast({
                  status: input?.query ? `Searching the web for "${input.query}"` : "Searching the web…",
                })
              } else if (type === "source-document" && typeof part.sourceId === "string" && typeof part.title === "string") {
                titleById.set(part.sourceId, part.title as string)
              } else if (type === "source-url" && typeof part.url === "string") {
                const url = part.url as string
                if (!webSources.some((w) => w.url === url)) {
                  const sid = typeof part.sourceId === "string" ? part.sourceId : ""
                  webSources.push({
                    isWeb: true,
                    url,
                    itemTitle: titleById.get(sid) || hostname(url),
                    itemId: "",
                    startSec: 0,
                    snippet: null,
                  })
                  patchLast({ sources: mergedSources() })
                }
              }
            }
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
        // The conversation may have just been auto-titled from the first message;
        // let consumers (e.g. the breadcrumb conversation list) refresh.
        onStreamEndRef.current?.()
      }
    },
    [conversationId, reload, syncAfterStream],
  )

  const send = useCallback(
    (content: string, itemId?: string) =>
      runStream({ content, itemId }, (prev) => [
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
