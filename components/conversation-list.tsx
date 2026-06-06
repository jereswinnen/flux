"use client"

import { useState } from "react"
import { Check, Pencil, Plus, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export type ConversationListItem = { id: string; title: string }

export function ConversationList({
  items,
  activeId,
  onSelect,
  onRename,
  onDelete,
  onNew,
}: {
  items: ConversationListItem[]
  activeId: string | null
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onNew: () => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")

  function startEdit(item: ConversationListItem) {
    setEditingId(item.id)
    setDraft(item.title)
  }
  function commit(id: string) {
    const t = draft.trim()
    if (t) onRename(id, t)
    setEditingId(null)
  }

  return (
    <div className="space-y-2">
      <Button onClick={onNew} className="w-full gap-2" variant="outline" size="sm">
        <Plus className="size-4" /> New chat
      </Button>
      <div className="space-y-0.5">
        {items.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No conversations yet.</p>
        )}
        {items.map((c) =>
          editingId === c.id ? (
            <div key={c.id} className="flex items-center gap-1 px-1">
              <Input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit(c.id)
                  if (e.key === "Escape") setEditingId(null)
                }}
                className="h-7 text-sm"
              />
              <button type="button" aria-label="Save" onClick={() => commit(c.id)} className="text-muted-foreground hover:text-foreground">
                <Check className="size-3.5" />
              </button>
              <button type="button" aria-label="Cancel" onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground">
                <X className="size-3.5" />
              </button>
            </div>
          ) : (
            <div
              key={c.id}
              className={`group flex items-center justify-between rounded-md px-2 py-1.5 text-sm ${
                c.id === activeId ? "bg-muted" : "hover:bg-muted/50"
              }`}
            >
              <button type="button" onClick={() => onSelect(c.id)} className="min-w-0 flex-1 truncate text-left">
                {c.title}
              </button>
              <div className="ml-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100">
                <button type="button" aria-label="Rename conversation" onClick={() => startEdit(c)}>
                  <Pencil className="size-3.5 text-muted-foreground hover:text-foreground" />
                </button>
                <button type="button" aria-label="Delete conversation" onClick={() => onDelete(c.id)}>
                  <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  )
}
