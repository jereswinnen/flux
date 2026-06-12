import { describe, expect, it } from "vitest"
import { parseArticle, paragraphsToSegments, assertFetchableUrl } from "@/lib/article/extract"

const HTML = `<!doctype html><html><head>
  <title>The Real Headline</title>
  <meta property="og:image" content="/images/hero.jpg">
  <meta property="og:site_name" content="Example Times">
  <meta name="author" content="Jane Doe">
  <meta property="article:published_time" content="2026-01-02T03:04:05Z">
</head><body>
  <article>
    <h1>The Real Headline</h1>
    <p>First paragraph with enough words to clear the readability content
       threshold so the parser treats this as a genuine article body and not
       boilerplate navigation chrome that should be discarded.</p>
    <p>Second paragraph continues the discussion with additional sentences,
       a <a href="/rel/link">relative link</a> and an
       <img src="/rel/inline.png" alt="inline"> inline image to absolutize.</p>
    <script>window.evil = 1</script>
    <p onclick="steal()">Third paragraph with an event handler to strip.</p>
  </article>
</body></html>`

describe("parseArticle", () => {
  const a = parseArticle(HTML, "https://example.com/news/story")

  it("pulls title, byline, site name, lead image (absolutized)", () => {
    expect(a.title).toBe("The Real Headline")
    expect(a.byline).toBe("Jane Doe")
    expect(a.siteName).toBe("Example Times")
    expect(a.leadImageUrl).toBe("https://example.com/images/hero.jpg")
    expect(a.publishedAt).toBe("2026-01-02T03:04:05Z")
  })

  it("returns plain textContent for the pipeline", () => {
    expect(a.textContent).toContain("First paragraph")
    expect(a.textContent).not.toContain("<p>")
  })

  it("sanitizes: no scripts, no event handlers, absolutized urls", () => {
    expect(a.contentHtml).not.toContain("<script")
    expect(a.contentHtml).not.toContain("onclick")
    expect(a.contentHtml).not.toContain("window.evil")
    expect(a.contentHtml).toContain('href="https://example.com/rel/link"')
    expect(a.contentHtml).toContain('src="https://example.com/rel/inline.png"')
    expect(a.contentHtml).toContain('loading="lazy"')
  })
})

describe("paragraphsToSegments", () => {
  it("splits on blank lines, zero timestamps", () => {
    const segs = paragraphsToSegments("one two\n\nthree four\n\n  \n\nfive")
    expect(segs).toEqual([
      { start: 0, end: 0, text: "one two" },
      { start: 0, end: 0, text: "three four" },
      { start: 0, end: 0, text: "five" },
    ])
  })
})

describe("assertFetchableUrl", () => {
  it("allows public http(s) URLs", () => {
    expect(assertFetchableUrl("https://example.com/x").hostname).toBe("example.com")
  })
  it("rejects local/private/non-http targets", () => {
    expect(() => assertFetchableUrl("http://localhost/x")).toThrow()
    expect(() => assertFetchableUrl("http://127.0.0.1/x")).toThrow()
    expect(() => assertFetchableUrl("http://169.254.169.254/latest")).toThrow()
    expect(() => assertFetchableUrl("http://192.168.1.1/")).toThrow()
    expect(() => assertFetchableUrl("file:///etc/passwd")).toThrow()
  })
})
