/** Extract an 11-char YouTube video id from common URL shapes, else null. */
export function parseYouTubeId(input: string): string | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  const host = url.hostname.replace(/^www\.|^m\./, "")
  const id = (() => {
    if (host === "youtu.be") return url.pathname.slice(1)
    if (host === "youtube.com" || host === "music.youtube.com") {
      if (url.pathname === "/watch") return url.searchParams.get("v") ?? ""
      const m = url.pathname.match(/^\/(shorts|embed|v)\/([^/]+)/)
      if (m) return m[2]
    }
    return ""
  })()
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
}

export function isYouTubeUrl(input: string): boolean {
  return parseYouTubeId(input) !== null
}
