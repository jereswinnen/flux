"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Copy, Download, MoreVertical, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  buildEpisodeMarkdown,
  type ExportEpisode,
  type ExportInsights,
  type ExportTranscript,
} from "@/lib/export/episode-markdown"
import { slugify } from "@/lib/export/slug"

export function EpisodeActions({
  episodeId,
  episode,
  transcript,
  insights,
}: {
  episodeId: string
  episode: ExportEpisode
  transcript: ExportTranscript
  insights: ExportInsights
}) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const markdown = () => buildEpisodeMarkdown(episode, transcript, insights)

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown())
      toast.success("Copied markdown")
    } catch {
      toast.error("Copy failed")
    }
  }

  function download() {
    const blob = new Blob([markdown()], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${slugify(episode.title)}.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function remove() {
    const res = await fetch(`/api/episodes/${episodeId}`, { method: "DELETE" })
    if (res.ok) {
      toast.success("Episode deleted")
      router.push("/")
    } else {
      toast.error("Delete failed")
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Episode actions">
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem onClick={copy} className="whitespace-nowrap">
            <Copy className="size-4" /> Copy markdown
          </DropdownMenuItem>
          <DropdownMenuItem onClick={download} className="whitespace-nowrap">
            <Download className="size-4" /> Download .md
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setConfirmOpen(true)}
            className="whitespace-nowrap text-destructive focus:text-destructive"
          >
            <Trash2 className="size-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this episode?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes its transcript, insights, and chats. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-destructive text-white hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
