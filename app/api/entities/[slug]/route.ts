import { db } from "@/lib/db"
import { getEntityBySlug, itemsMentioningEntity, coMentionedEntities } from "@/lib/db/entities"

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const entity = await getEntityBySlug(db, slug)
  if (!entity) return Response.json({ error: "not found" }, { status: 404 })

  const [mentions, relatedEntities] = await Promise.all([
    itemsMentioningEntity(db, entity.id),
    coMentionedEntities(db, entity.id),
  ])

  return Response.json({
    entity: {
      id: entity.id,
      name: entity.name,
      slug: entity.slug,
      type: entity.type,
      description: entity.description,
      summary: entity.summary,
      imageUrl: entity.imageUrl,
      wikipediaUrl: entity.wikipediaUrl,
      externalIds: entity.externalIds,
      metadata: entity.metadata,
    },
    mentions: mentions.map((m) => ({
      id: m.id,
      title: m.title,
      podcastName: m.podcastName,
      artworkUrl: m.artworkUrl,
      context: m.context,
      approxTimestampSec: m.approxTimestampSec,
    })),
    relatedEntities: relatedEntities.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      type: r.type,
      imageUrl: r.imageUrl,
      sharedItems: r.sharedItems,
    })),
  })
}
