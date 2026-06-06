"use client"

import { useEffect, useState } from "react"
import { ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ConversationList, type ConversationListItem } from "@/components/conversation-list"

export function ConversationSwitcher({
  episodeId,
  activeId,
  onSelect,
}: {
  episodeId: string
  activeId: string | null
  onSelect: (id: string) => void
}) {
  const [convos, setConvos] = useState<ConversationListItem[]>([])
  const [open, setOpen] = useState(false)

  async function refresh() {
    const d = await fetch(`/api/conversations?episodeId=${episodeId}`).then((r) => r.json())
    setConvos(d.conversations ?? [])
    return (d.conversations ?? []) as ConversationListItem[]
  }

  useEffect(() => {
    refresh().then((list) => {
      if (!activeId && list[0]) onSelect(list[0].id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId])

  async function onNew() {
    const d = await fetch("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ episodeId }),
    }).then((r) => r.json())
    await refresh()
    onSelect(d.conversation.id)
    setOpen(false)
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
    if (activeId === id) onSelect(list[0]?.id ?? "")
  }

  const activeTitle = convos.find((c) => c.id === activeId)?.title ?? "New chat"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 w-full justify-between text-xs">
          <span className="truncate">{activeTitle}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <ConversationList
          items={convos}
          activeId={activeId}
          onSelect={(id) => {
            onSelect(id)
            setOpen(false)
          }}
          onRename={onRename}
          onDelete={onDelete}
          onNew={onNew}
        />
      </PopoverContent>
    </Popover>
  )
}
