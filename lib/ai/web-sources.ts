import type { ChatSource } from "@/lib/db/schema"

/** A model "source" as emitted by the AI SDK for web-search results. */
export interface ModelSource {
  sourceType?: string
  id?: string
  url?: string
  title?: string
}

/** Display host for a URL (drops `www.`); returns the input on parse failure. */
export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

/** Map AI SDK web-search url sources to web `ChatSource` entries (deduped by url). */
export function toWebSources(sources: ModelSource[]): ChatSource[] {
  const seen = new Set<string>()
  const out: ChatSource[] = []
  for (const s of sources) {
    if (s.sourceType !== "url" || !s.url || seen.has(s.url)) continue
    seen.add(s.url)
    out.push({
      isWeb: true,
      url: s.url,
      itemTitle: s.title?.trim() || hostname(s.url),
      itemId: "",
      startSec: 0,
      snippet: null,
    })
  }
  return out
}
