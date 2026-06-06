"use client"

import { useEffect, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ConversationView } from "@/components/conversation-view"
import { useConversation } from "@/components/use-conversation"

type Convo = { id: string; title: string }

export function AskLibrary() {
  const [convos, setConvos] = useState<Convo[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const chat = useConversation(activeId)

  async function refresh() {
    const d = await fetch("/api/conversations?scope=library").then((r) => r.json())
    setConvos(d.conversations ?? [])
    return (d.conversations ?? []) as Convo[]
  }

  useEffect(() => {
    refresh().then((list) => setActiveId((id) => id ?? list[0]?.id ?? null))
  }, [])

  async function newChat() {
    const d = await fetch("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }).then((r) => r.json())
    await refresh()
    setActiveId(d.conversation.id)
  }

  async function remove(id: string) {
    await fetch(`/api/conversations/${id}`, { method: "DELETE" })
    const list = await refresh()
    if (activeId === id) setActiveId(list[0]?.id ?? null)
  }

  return (
    <div className="grid flex-1 gap-4 md:grid-cols-[240px_1fr]">
      <aside className="space-y-2">
        <Button onClick={newChat} className="w-full gap-2" variant="outline">
          <Plus className="size-4" /> New chat
        </Button>
        <div className="space-y-1">
          {convos.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center justify-between rounded-md px-2 py-1.5 text-sm ${
                c.id === activeId ? "bg-muted" : "hover:bg-muted/50"
              }`}
            >
              <button type="button" onClick={() => setActiveId(c.id)} className="min-w-0 flex-1 truncate text-left">
                {c.title}
              </button>
              <button
                type="button"
                aria-label="Delete conversation"
                onClick={() => remove(c.id)}
                className="ml-2 opacity-0 group-hover:opacity-100"
              >
                <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <Card className="flex min-h-[60vh] flex-col p-4">
        {activeId ? (
          <ConversationView chat={chat} disabled={!activeId} emptyHint="Ask anything across your whole library." />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <Button onClick={newChat}>Start your first conversation</Button>
          </div>
        )}
      </Card>
    </div>
  )
}
