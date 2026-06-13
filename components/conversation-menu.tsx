"use client"

import { useState } from "react"
import { Check, ChevronDown, Plus, Trash2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { ConversationListItem } from "@/components/conversation-list"

export function ConversationMenu({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  triggerClassName,
}: {
  conversations: ConversationListItem[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  triggerClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const activeTitle = conversations.find((c) => c.id === activeId)?.title ?? "New chat"

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1 text-sm font-normal text-foreground outline-none transition-colors hover:text-foreground/70",
            triggerClassName,
          )}
        >
          <span className="max-w-[45vw] truncate sm:max-w-xs">{activeTitle}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem
          onSelect={() => {
            setOpen(false)
            onNew()
          }}
        >
          <Plus className="size-4" /> New chat
        </DropdownMenuItem>
        {conversations.length > 0 && <DropdownMenuSeparator />}
        {conversations.map((c) => (
          <DropdownMenuItem
            key={c.id}
            onSelect={() => {
              onSelect(c.id)
              setOpen(false)
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
                onDelete(c.id)
              }}
              className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100 group-focus-within:opacity-100"
            >
              <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
            </button>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
