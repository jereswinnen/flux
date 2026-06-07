/**
 * iTunes serves podcast artwork at a size baked into the URL path, e.g.
 * `.../source/100x100bb.jpg`. The stored URL is often 100 or 600px, which
 * upscales blurry on retina screens. Swap the dimension segment for a larger
 * one so the browser gets a crisp image. Non-iTunes URLs (e.g. RSS
 * <itunes:image> hrefs) don't match the pattern and pass through unchanged.
 */
export function hiResArtwork(
  url: string | null | undefined,
  size = 600,
): string | undefined {
  if (!url) return undefined
  return url.replace(/\/\d+x\d+bb\.(jpg|jpeg|png|webp)/i, `/${size}x${size}bb.$1`)
}
