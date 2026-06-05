import { GlobalSearch } from "@/components/global-search"

export default function SearchPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Search</h1>
      <GlobalSearch />
    </div>
  )
}
