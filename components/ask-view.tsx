"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Plus } from "lucide-react"
import { AppHeader } from "@/components/app-header"
import { Button } from "@/components/ui/button"
import { ConversationMenu } from "@/components/conversation-menu"
import { ConversationView, type AttachableEpisode } from "@/components/conversation-view"
import { useConversation } from "@/components/use-conversation"
import { useConversationList } from "@/components/use-conversation-list"

export function AskView() {
  const searchParams = useSearchParams()
  const attachId = searchParams.get("attach")
  // Arriving from an episode's "Ask" button starts a fresh chat (don't reuse the
  // last conversation); otherwise resume the most recent one.
  const list = useConversationList(undefined, { autoStart: !attachId })
  const chat = useConversation(list.activeId, { onStreamEnd: () => void list.refresh() })
  const [episodes, setEpisodes] = useState<AttachableEpisode[]>([])
  const startedFresh = useRef(false)

  useEffect(() => {
    if (attachId && !startedFresh.current) {
      startedFresh.current = true
      void list.create()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachId])

  // Episodes power the @-mention picker and resolve the ?attach= deep link.
  useEffect(() => {
    type Row = {
      id: string
      title: string
      source?: string | null
      artworkUrl?: string | null
      audioUrl?: string | null
      videoId?: string | null
    }
    fetch("/api/items")
      .then((r) => r.json())
      .then((d) =>
        setEpisodes(
          (d.items ?? []).map((e: Row) => ({
            id: e.id,
            title: e.title,
            podcastName: e.source,
            artworkUrl: e.artworkUrl,
            audioUrl: e.audioUrl,
            videoId: e.videoId ?? null,
          })),
        ),
      )
      .catch(() => {})
  }, [])

  const initialAttachment = useMemo(
    () => (attachId ? episodes.find((e) => e.id === attachId) ?? null : null),
    [attachId, episodes],
  )

  return (
    <>
      <AppHeader
        breadcrumbs={[{ label: "Ask", href: "/ask" }]}
        breadcrumbMenu={
          <ConversationMenu
            conversations={list.conversations}
            activeId={list.activeId}
            onSelect={list.setActiveId}
            onNew={() => void list.create()}
            onDelete={(id) => void list.remove(id)}
          />
        }
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => void list.create()}>
            <Plus className="size-4" /> New chat
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col p-4 md:p-6">
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
          <ConversationView
            chat={chat}
            disabled={!list.activeId}
            episodes={episodes}
            initialAttachment={initialAttachment}
            emptyHint="Ask anything across your library — or type @ to attach a specific episode."
          />
        </div>
      </div>
    </>
  )
}
