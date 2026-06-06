"use client"

import { Card } from "@/components/ui/card"
import { ChatPanel, useEpisodeChat } from "@/components/episode-chat"

export function AskLibrary() {
  // No episodeId → the chat searches across the whole library.
  const chat = useEpisodeChat()
  return (
    <Card className="mx-auto w-full max-w-2xl space-y-3 p-5">
      <ChatPanel chat={chat} />
    </Card>
  )
}
