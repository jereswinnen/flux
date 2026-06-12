export const AUDIO_FILE_EXT = /\.(mp3|m4a|aac|ogg|oga|wav|flac)(\?|#|$)/i

export function isUrl(value: string): boolean {
  const v = value.trim()
  if (!/^https?:\/\//i.test(v)) return false
  try {
    new URL(v)
    return true
  } catch {
    return false
  }
}

export function looksLikeFeedUrl(value: string): boolean {
  if (!isUrl(value)) return false
  const v = value.trim().toLowerCase()
  return (
    v.endsWith(".xml") ||
    v.endsWith(".rss") ||
    v.includes("/rss") ||
    v.includes("/feed") ||
    v.includes("feeds.")
  )
}
