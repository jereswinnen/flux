import { Readability } from "@mozilla/readability"
import { parseHTML } from "linkedom"
import sanitizeHtml from "sanitize-html"
import type { Segment } from "@/lib/ai/chunk"

export interface ExtractedArticle {
  title: string
  byline?: string
  siteName?: string
  leadImageUrl?: string
  excerpt?: string
  publishedAt?: string
  contentHtml: string
  textContent: string
}

/** Absolutize a possibly-relative URL against the article URL; drop on failure. */
function absolutize(href: string | null | undefined, base: string): string | undefined {
  if (!href) return undefined
  try {
    return new URL(href, base).toString()
  } catch {
    return undefined
  }
}

function sanitize(html: string, base: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "h1", "h2", "h3", "h4", "p", "ul", "ol", "li", "blockquote", "pre", "code",
      "a", "img", "strong", "em", "b", "i", "figure", "figcaption", "hr", "br",
    ],
    allowedAttributes: { a: ["href"], img: ["src", "alt", "loading", "decoding"] },
    allowedSchemes: ["http", "https"],
    transformTags: {
      a: (_tagName, attribs) => {
        const href = absolutize(attribs.href, base)
        const outAttribs: Record<string, string> = href
          ? { href, target: "_blank", rel: "noopener noreferrer" }
          : {}
        return { tagName: "a", attribs: outAttribs }
      },
      img: (_tagName, attribs) => {
        const src = absolutize(attribs.src, base)
        const outAttribs: Record<string, string> = src
          ? { src, alt: attribs.alt ?? "", loading: "lazy", decoding: "async" }
          : {}
        return { tagName: "img", attribs: outAttribs }
      },
    },
    exclusiveFilter: (f) =>
      (f.tag === "a" && !f.attribs.href) || (f.tag === "img" && !f.attribs.src),
  })
}

/** Pure parse + sanitize. `url` is used to absolutize relative links/images. */
export function parseArticle(html: string, url: string): ExtractedArticle {
  const { document } = parseHTML(html)

  const meta = (sel: string) =>
    document.querySelector(sel)?.getAttribute("content") ?? undefined
  const ogImage = meta('meta[property="og:image"]') ?? meta('meta[name="twitter:image"]')
  const ogSite = meta('meta[property="og:site_name"]')
  const published = meta('meta[property="article:published_time"]')
  // Capture h1 before Readability mutates the document (it demotes h1→h2).
  const articleH1 = document.querySelector("article h1, h1")?.textContent?.trim()

  const parsed = new Readability(document as unknown as Document).parse()
  if (!parsed || !parsed.textContent || parsed.textContent.trim().length < 200) {
    throw new Error("Could not extract article content from this page")
  }

  const contentHtml = sanitize(parsed.content ?? "", url)
  const contentDoc = parseHTML(contentHtml).document
  const firstImg = contentDoc.querySelector("img")?.getAttribute("src")
  return {
    title: (articleH1 || parsed.title || (document as unknown as Document).title || url).trim(),
    byline: parsed.byline?.trim() || meta('meta[name="author"]'),
    siteName: parsed.siteName?.trim() || ogSite,
    leadImageUrl: absolutize(ogImage, url) ?? firstImg ?? undefined,
    excerpt: parsed.excerpt?.trim() || undefined,
    publishedAt: published,
    contentHtml,
    textContent: parsed.textContent.trim(),
  }
}

/** Fetch the page then parse it. Throws on network / non-HTML / empty body. */
export async function extractArticle(url: string): Promise<ExtractedArticle> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
    },
  })
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`)
  const ct = res.headers.get("content-type") ?? ""
  if (!ct.includes("html")) throw new Error("URL is not an HTML page")
  const html = await res.text()
  return parseArticle(html, url)
}

/** Article body → pipeline segments. Articles have no timestamps (start/end 0). */
export function paragraphsToSegments(text: string): Segment[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((t) => ({ start: 0, end: 0, text: t }))
}
