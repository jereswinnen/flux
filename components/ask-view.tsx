"use client"

import { AppHeader } from "@/components/app-header"
import { ConversationMenu } from "@/components/conversation-menu"
import { ConversationView } from "@/components/conversation-view"
import { useConversation } from "@/components/use-conversation"
import { useConversationList } from "@/components/use-conversation-list"

export function AskView() {
  const list = useConversationList()
  const chat = useConversation(list.activeId)

  return (
    <>
      <AppHeader
        breadcrumbs={[{ label: "Ask" }]}
        actions={
          <ConversationMenu
            conversations={list.conversations}
            activeId={list.activeId}
            onSelect={list.setActiveId}
            onNew={() => void list.create()}
            onDelete={(id) => void list.remove(id)}
          />
        }
      />
      <div className="flex min-h-0 flex-1 flex-col p-4 md:p-6">
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
          <ConversationView
            chat={chat}
            disabled={!list.activeId}
            emptyHint="Ask anything across your whole library."
          />
        </div>
      </div>
    </>
  )
}
