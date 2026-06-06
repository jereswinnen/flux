"use client"

import { useEffect, useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type Convo = { id: string; title: string }

export function ConversationSwitcher({
  episodeId,
  activeId,
  onSelect,
}: {
  episodeId: string
  activeId: string | null
  onSelect: (id: string) => void
}) {
  const [convos, setConvos] = useState<Convo[]>([])

  async function refresh() {
    const d = await fetch(`/api/conversations?episodeId=${episodeId}`).then((r) => r.json())
    setConvos(d.conversations ?? [])
    return (d.conversations ?? []) as Convo[]
  }

  useEffect(() => {
    refresh().then((list) => {
      if (!activeId && list[0]) onSelect(list[0].id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId])

  async function newChat() {
    const d = await fetch("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ episodeId }),
    }).then((r) => r.json())
    await refresh()
    onSelect(d.conversation.id)
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={activeId ?? undefined} onValueChange={onSelect}>
        <SelectTrigger className="h-8 flex-1 text-xs">
          <SelectValue placeholder="No conversations yet" />
        </SelectTrigger>
        <SelectContent>
          {convos.map((c) => (
            <SelectItem key={c.id} value={c.id} className="text-xs">
              {c.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="icon" variant="outline" className="size-8 shrink-0" onClick={newChat} aria-label="New chat">
        <Plus className="size-4" />
      </Button>
    </div>
  )
}
