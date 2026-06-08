"use client"

import { useEffect, useRef, useState } from "react"
import { Check, ChevronDown, MessageSquarePlus, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ConversationView } from "@/components/conversation-view"
import { useConversation } from "@/components/use-conversation"
import type { ConversationListItem } from "@/components/conversation-list"

export function ChatPanel({
  episodeId,
  onSeek,
  emptyHint = "Ask a question to get started.",
}: {
  episodeId?: string
  onSeek?: (sec: number) => void
  emptyHint?: string
}) {
  const [convos, setConvos] = useState<ConversationListItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const chat = useConversation(activeId)
  // Guard so we auto-create at most one empty conversation per scope.
  const seeded = useRef(false)

  const scopeQuery = episodeId ? `episodeId=${episodeId}` : "scope=library"

  async function refresh() {
    const d = await fetch(`/api/conversations?${scopeQuery}`).then((r) => r.json())
    const list = (d.conversations ?? []) as ConversationListItem[]
    setConvos(list)
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

  useEffect(() => {
    seeded.current = false
    refresh().then(async (list) => {
      if (list[0]) {
        setActiveId(list[0].id)
      } else if (!seeded.current) {
        seeded.current = true
        await create()
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId])

  async function onNew() {
    setMenuOpen(false)
    await create()
  }

  async function onDelete(id: string) {
    await fetch(`/api/conversations/${id}`, { method: "DELETE" })
    const list = await refresh()
    if (activeId === id) {
      if (list[0]) setActiveId(list[0].id)
      else setActiveId(await create())
    }
  }

  const activeTitle = convos.find((c) => c.id === activeId)?.title ?? "New chat"

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b px-2 py-2">
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 min-w-0 flex-1 justify-start gap-1.5 px-2">
              <span className="truncate font-medium">{activeTitle}</span>
              <ChevronDown className="size-3.5 shrink-0 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuItem onSelect={onNew}>
              <Plus className="size-4" /> New chat
            </DropdownMenuItem>
            {convos.length > 0 && <DropdownMenuSeparator />}
            {convos.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onSelect={() => {
                  setActiveId(c.id)
                  setMenuOpen(false)
                }}
                className="group justify-between gap-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Check className={`size-3.5 shrink-0 ${c.id === activeId ? "opacity-100" : "opacity-0"}`} />
                  <span className="truncate">{c.title}</span>
                </span>
                <button
                  type="button"
                  aria-label="Delete conversation"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    void onDelete(c.id)
                  }}
                  className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="New chat" onClick={onNew}>
          <MessageSquarePlus className="size-4" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-3">
        <ConversationView chat={chat} onSeek={onSeek} disabled={!activeId} emptyHint={emptyHint} />
      </div>
    </div>
  )
}
