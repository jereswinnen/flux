import { NextResponse, type NextRequest } from "next/server"

export function proxy(req: NextRequest) {
  const token = process.env.API_AUTH_TOKEN
  if (!token) return NextResponse.next() // open by default (current behavior)
  const appUrl = process.env.APP_URL ?? ""
  if (!appUrl) {
    // Misconfiguration: with a token but no APP_URL, same-origin can't be
    // recognized and the web app's own fetches would all 401. Warn loudly.
    console.warn("[proxy] API_AUTH_TOKEN is set but APP_URL is not — same-origin web requests will be rejected")
  }
  const origin = req.headers.get("origin") ?? req.headers.get("referer") ?? ""
  // Exact origin match (not a prefix) so `https://app.example.com.evil.com`
  // can't slip past; the trailing-slash form admits Referer's path.
  const sameOrigin = appUrl !== "" && (origin === appUrl || origin.startsWith(appUrl + "/"))
  const bearer = req.headers.get("authorization") === `Bearer ${token}`
  if (sameOrigin || bearer) return NextResponse.next()
  return new NextResponse("Unauthorized", { status: 401 })
}

export const config = {
  // All API routes except the Modal webhook (it has its own HMAC secret).
  matcher: ["/api/((?!modal/callback).*)"],
}
