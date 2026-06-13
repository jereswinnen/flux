import { itemRepo } from "@/lib/db/items"
import { itemToDTO } from "@/lib/api/dto"
import { AppHeader } from "@/components/app-header"
import { Library } from "@/components/library"

export const dynamic = "force-dynamic"

export default async function Page() {
  const rows = await itemRepo.list()
  return (
    <>
      <AppHeader breadcrumbs={[{ label: "Library" }]} />
      <Library initialEpisodes={rows.map(itemToDTO)} />
    </>
  )
}
