import { NextResponse, type NextRequest } from "next/server"

export function middleware(req: NextRequest) {
  const token = process.env.API_AUTH_TOKEN
  if (!token) return NextResponse.next() // open by default (current behavior)
  const origin = req.headers.get("origin") ?? req.headers.get("referer") ?? ""
  const appUrl = process.env.APP_URL ?? ""
  const sameOrigin = appUrl !== "" && origin.startsWith(appUrl)
  const bearer = req.headers.get("authorization") === `Bearer ${token}`
  if (sameOrigin || bearer) return NextResponse.next()
  return new NextResponse("Unauthorized", { status: 401 })
}

export const config = {
  // All API routes except the Modal webhook (it has its own HMAC secret).
  matcher: ["/api/((?!modal/callback).*)"],
}
