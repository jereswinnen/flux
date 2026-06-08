"use client"

import { useEffect, useRef, useState } from "react"
import type { ConversationListItem } from "@/components/conversation-list"

// Manages the list of conversations for a scope (an episode, or library-wide)
// plus which one is active. Auto-creates one empty conversation if none exist.
export function useConversationList(
  episodeId?: string,
  opts: { autoStart?: boolean } = {},
) {
  const autoStart = opts.autoStart ?? true
  const [conversations, setConversations] = useState<ConversationListItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const seeded = useRef(false)
  const scopeQuery = episodeId ? `episodeId=${episodeId}` : "scope=library"

  async function refresh() {
    const d = await fetch(`/api/conversations?${scopeQuery}`).then((r) => r.json())
    const list = (d.conversations ?? []) as ConversationListItem[]
    setConversations(list)
    return list
  }

  async function create() {
    const d = await fetch("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(episodeId ? { episodeId } : {}),
    }).then((r) => r.json())
    await refresh()
    setActiveId(d.conversation.id)
    return d.conversation.id as string
  }

  async function remove(id: string) {
    await fetch(`/api/conversations/${id}`, { method: "DELETE" })
    const list = await refresh()
    if (activeId === id) setActiveId(list[0]?.id ?? (await create()))
  }

  useEffect(() => {
    seeded.current = false
    refresh().then(async (list) => {
      // When autoStart is off, the caller will pick/create the active conversation
      // (e.g. the Ask deep link wants a brand-new chat) — just load the list.
      if (!autoStart) return
      if (list[0]) {
        setActiveId(list[0].id)
      } else if (!seeded.current) {
        seeded.current = true
        await create()
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId])

  return { conversations, activeId, setActiveId, create, remove, refresh }
}
