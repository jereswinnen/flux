"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ConversationView } from "@/components/conversation-view"
import { ConversationList, type ConversationListItem } from "@/components/conversation-list"
import { useConversation } from "@/components/use-conversation"

export function AskLibrary() {
  const [convos, setConvos] = useState<ConversationListItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const chat = useConversation(activeId)

  async function refresh() {
    const d = await fetch("/api/conversations?scope=library").then((r) => r.json())
    setConvos(d.conversations ?? [])
    return (d.conversations ?? []) as ConversationListItem[]
  }

  useEffect(() => {
    refresh().then((list) => setActiveId((id) => id ?? list[0]?.id ?? null))
  }, [])

  async function onNew() {
    const d = await fetch("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }).then((r) => r.json())
    await refresh()
    setActiveId(d.conversation.id)
  }
  async function onRename(id: string, title: string) {
    await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    })
    await refresh()
  }
  async function onDelete(id: string) {
    await fetch(`/api/conversations/${id}`, { method: "DELETE" })
    const list = await refresh()
    if (activeId === id) setActiveId(list[0]?.id ?? null)
  }

  return (
    <div className="grid flex-1 gap-4 md:grid-cols-[240px_1fr]">
      <aside>
        <ConversationList
          items={convos}
          activeId={activeId}
          onSelect={setActiveId}
          onRename={onRename}
          onDelete={onDelete}
          onNew={onNew}
        />
      </aside>
      <Card className="flex min-h-[60vh] flex-col p-4">
        {activeId ? (
          <ConversationView chat={chat} emptyHint="Ask anything across your whole library." />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <Button onClick={onNew}>Start your first conversation</Button>
          </div>
        )}
      </Card>
    </div>
  )
}
