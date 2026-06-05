import Link from "next/link"
import { AddEpisode } from "@/components/add-episode"
import { Button } from "@/components/ui/button"

export default function Page() {
  return (
    <div className="mx-auto flex min-h-svh max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Podcast Knowledge Base</h1>
        <Button asChild variant="outline">
          <Link href="/episodes">Archive</Link>
        </Button>
      </header>
      <AddEpisode />
    </div>
  )
}
