"use client"

import { MessageSquarePlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConversationView } from "@/components/conversation-view"
import { ConversationMenu } from "@/components/conversation-menu"
import { useConversation } from "@/components/use-conversation"
import { useConversationList } from "@/components/use-conversation-list"

export function ChatPanel({
  episodeId,
  onSeek,
  emptyHint = "Ask a question to get started.",
}: {
  episodeId?: string
  onSeek?: (sec: number) => void
  emptyHint?: string
}) {
  const list = useConversationList(episodeId)
  const chat = useConversation(list.activeId)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-1 border-b px-3 py-2">
        <ConversationMenu
          conversations={list.conversations}
          activeId={list.activeId}
          onSelect={list.setActiveId}
          onNew={() => void list.create()}
          onDelete={(id) => void list.remove(id)}
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label="New chat"
          onClick={() => void list.create()}
        >
          <MessageSquarePlus className="size-4" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-3">
        <ConversationView chat={chat} onSeek={onSeek} disabled={!list.activeId} emptyHint={emptyHint} />
      </div>
    </div>
  )
}
