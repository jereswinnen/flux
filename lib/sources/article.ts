import type { ItemRow } from "@/lib/api/dto"
import { db } from "@/lib/db"
import { itemRepo } from "@/lib/db/items"
import type { NewItem } from "@/lib/db/items"
import { processContent } from "@/lib/pipeline/process-content"
import { extractArticle, paragraphsToSegments } from "@/lib/article/extract"
import { isUrl, looksLikeFeedUrl } from "@/lib/url"
import { isYouTubeUrl } from "@/lib/sources/youtube-url"
import type { SourceAdapter } from "./types"

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|wav|flac)(\?|#|$)/i

export const articleAdapter: SourceAdapter = {
  type: "article",
  detect: (input) =>
    isUrl(input) &&
    !isYouTubeUrl(input) &&
    !looksLikeFeedUrl(input) &&
    !AUDIO_EXT.test(input.trim()),
  async resolve(input): Promise<NewItem> {
    return {
      type: "article",
      title: input.trim(),
      sourceUrl: input.trim(),
    }
  },
  async startProcessing(item: ItemRow) {
    if (!item.sourceUrl) throw new Error("article item missing sourceUrl")
    const article = await extractArticle(item.sourceUrl)

    const mapped: Parameters<typeof itemRepo.updateMeta>[1] = {}
    if (article.title) mapped.title = article.title
    const podcastName = article.byline ?? article.siteName
    if (podcastName) mapped.podcastName = podcastName
    if (article.leadImageUrl) mapped.artworkUrl = article.leadImageUrl
    if (article.publishedAt) mapped.publishedAt = new Date(article.publishedAt)
    await itemRepo.updateMeta(item.id, mapped)

    await processContent(
      {
        itemId: item.id,
        transcript: article.textContent,
        segments: paragraphsToSegments(article.textContent),
        contentHtml: article.contentHtml,
      },
      { db },
    )
  },
}
