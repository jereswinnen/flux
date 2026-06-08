import { AppHeader } from "@/components/app-header"
import { SearchView } from "@/components/search-view"

export const dynamic = "force-dynamic"

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  return (
    <>
      <AppHeader breadcrumbs={[{ label: "Search" }]} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 md:p-6">
        <SearchView query={q ?? ""} />
      </div>
    </>
  )
}
