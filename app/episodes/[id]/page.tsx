import { redirect } from "next/navigation"

export default async function LegacyEpisodeRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/items/${id}`)
}
