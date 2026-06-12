import { db } from "@/lib/db"
import { makeHighlightRepo } from "@/lib/db/highlights"
import { highlightToDTO } from "@/lib/api/highlight-dto"
import { AppHeader } from "@/components/app-header"
import { HighlightsFeed } from "@/components/highlights-feed"

export const dynamic = "force-dynamic"

export default async function HighlightsPage() {
  const rows = await makeHighlightRepo(db).list({})
  const highlights = rows.map(highlightToDTO)
  return (
    <>
      <AppHeader breadcrumbs={[{ label: "Highlights" }]} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
          <HighlightsFeed initial={highlights} />
        </div>
      </div>
    </>
  )
}
