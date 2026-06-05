# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the frontend as an app-like dashboard — sidebar shell, unified Library (archive + semantic search), a ⌘K command palette for adding episodes (artwork + show→episode drill-down), and a restyled episode detail page.

**Architecture:** A persistent shadcn `Sidebar` shell in the root layout wraps every page. The home page is the Library (server-fetched episode grid + client-side semantic search). A global ⌘K `CommandDialog`, mounted once in the shell via a small React context, handles iTunes/RSS discovery and ingestion. No API/schema changes — pure frontend on existing endpoints.

**Tech Stack:** Next.js 16 (App Router), shadcn/ui (style `radix-rhea`, lucide icons), Tailwind v4, `next-themes`, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-05-ui-redesign-design.md`

### Conventions (read before starting)
- Next.js 16: route handlers/pages already exist; dynamic params are async (`await params`). Client components need `"use client"`.
- Path alias `@/*` → repo root. shadcn aliases: `@/components/ui`, `@/components`, `@/lib`.
- pnpm. Tests: `pnpm test` (Vitest, sequential). Verify UI with `pnpm typecheck` and `pnpm build`.
- **Use the `shadcn` skill** when adding components (`pnpm dlx shadcn@latest add …`). `globals.css` already contains the `--sidebar-*` tokens.
- `.env.local` has a working `DATABASE_URL`, so `next build` works. Never commit `.env.local`.
- Existing APIs (unchanged): `GET /api/episodes`, `GET /api/episodes/:id`, `GET /api/itunes/search?q=&type=podcast|episode`, `GET /api/itunes/episodes?feedUrl=`, `POST /api/episodes`, `POST /api/search`, `POST /api/chat`, `POST /api/episodes/:id/retry`.

### API response shapes (for reference)
- `itunes/search?type=podcast` → `{ results: { collectionId, name, artistName, artworkUrl?, feedUrl? }[] }`
- `itunes/search?type=episode` → `{ results: { trackId, collectionId, title, podcastName, audioUrl?, artworkUrl?, feedUrl?, releaseDate?, durationSec? }[] }`
- `itunes/episodes?feedUrl=` → `{ showName?, artworkUrl?, episodes: { title, guid?, audioUrl, audioType?, publishedAt?, durationSec?, description? }[] }`
- `POST /api/search` → `{ hits: { chunkId, episodeId, episodeTitle, content, startSec, endSec, similarity }[] }`
- `GET /api/episodes` → `{ episodes: Episode[] }`; `Episode` has `id, title, podcastName, audioUrl, artworkUrl, status, publishedAt, createdAt, errorMessage` (timestamps are ISO strings over JSON).

---

## Task 1: Helpers, shadcn components, theme toggle

**Files:**
- Create: `lib/url.ts`
- Modify: `lib/format.ts`
- Create: `components/theme-toggle.tsx`
- Test: `test/lib/url.test.ts`, `test/lib/format.test.ts`
- Add shadcn: `sidebar breadcrumb separator command dialog skeleton scroll-area tooltip dropdown-menu avatar`

- [ ] **Step 1: Add shadcn components**

Run: `pnpm dlx shadcn@latest add sidebar breadcrumb separator command dialog skeleton scroll-area tooltip dropdown-menu avatar`
Accept defaults. Confirm files appear under `components/ui/` (sidebar.tsx, breadcrumb.tsx, separator.tsx, command.tsx, dialog.tsx, skeleton.tsx, scroll-area.tsx, tooltip.tsx, dropdown-menu.tsx, avatar.tsx). `command` pulls in the `cmdk` dependency — confirm `cmdk` is in package.json (run `pnpm add cmdk` if the CLI didn't add it).

- [ ] **Step 2: Write failing test `test/lib/url.test.ts`**

```ts
import { expect, test } from "vitest"
import { isUrl, looksLikeFeedUrl } from "@/lib/url"

test("isUrl detects http(s) URLs", () => {
  expect(isUrl("https://example.com/a.mp3")).toBe(true)
  expect(isUrl("http://x.io")).toBe(true)
  expect(isUrl("  https://x.io  ")).toBe(true)
  expect(isUrl("the daily")).toBe(false)
  expect(isUrl("example.com")).toBe(false)
})

test("looksLikeFeedUrl detects feed-ish URLs", () => {
  expect(looksLikeFeedUrl("https://feeds.megaphone.fm/the-daily")).toBe(true)
  expect(looksLikeFeedUrl("https://example.com/podcast.xml")).toBe(true)
  expect(looksLikeFeedUrl("https://example.com/rss")).toBe(true)
  expect(looksLikeFeedUrl("https://cdn.example.com/ep1.mp3")).toBe(false)
  expect(looksLikeFeedUrl("not a url")).toBe(false)
})
```

- [ ] **Step 3: Run to verify fail**

Run: `pnpm test test/lib/url.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `lib/url.ts`**

```ts
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
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm test test/lib/url.test.ts`
Expected: PASS.

- [ ] **Step 6: Write failing test `test/lib/format.test.ts`**

```ts
import { expect, test } from "vitest"
import { formatRelativeDate, formatTimestamp } from "@/lib/format"

const now = new Date("2026-06-05T12:00:00Z")

test("formatRelativeDate buckets recent dates", () => {
  expect(formatRelativeDate("2026-06-05T08:00:00Z", now)).toBe("today")
  expect(formatRelativeDate("2026-06-04T08:00:00Z", now)).toBe("yesterday")
  expect(formatRelativeDate("2026-06-01T12:00:00Z", now)).toBe("4 days ago")
  expect(formatRelativeDate("2026-05-20T12:00:00Z", now)).toBe("2w ago")
  expect(formatRelativeDate(null, now)).toBe("")
})

test("formatTimestamp still works (unchanged)", () => {
  expect(formatTimestamp(75)).toBe("1:15")
})
```

- [ ] **Step 7: Run to verify fail**

Run: `pnpm test test/lib/format.test.ts`
Expected: FAIL (`formatRelativeDate` not exported).

- [ ] **Step 8: Add `formatRelativeDate` to `lib/format.ts`** (keep existing `formatTimestamp`/`formatDate`)

```ts
export function formatRelativeDate(iso?: string | null, now: Date = new Date()): string {
  if (!iso) return ""
  const d = new Date(iso)
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 7) return `${days} days ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return d.toLocaleDateString()
}
```

- [ ] **Step 9: Run to verify pass**

Run: `pnpm test test/lib/format.test.ts`
Expected: PASS.

- [ ] **Step 10: Create `components/theme-toggle.tsx`**

```tsx
"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { SidebarMenuButton } from "@/components/ui/sidebar"

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <SidebarMenuButton
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      tooltip="Toggle theme"
    >
      <Sun className="hidden size-4 dark:block" />
      <Moon className="block size-4 dark:hidden" />
      <span>Toggle theme</span>
    </SidebarMenuButton>
  )
}
```

- [ ] **Step 11: Typecheck + commit**

Run: `pnpm typecheck` (expect clean).
```bash
git add lib/url.ts lib/format.ts components/theme-toggle.tsx components/ui test/lib package.json pnpm-lock.yaml app/globals.css components.json
git commit -m "feat: add UI helpers, theme toggle, and shadcn components for redesign"
```

---

## Task 2: Command palette context + AddCommand (⌘K)

**Files:**
- Create: `components/command-context.tsx`
- Create: `components/add-command.tsx`

- [ ] **Step 1: Create `components/command-context.tsx`**

```tsx
"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

type CommandCtx = { open: boolean; setOpen: (o: boolean) => void; openCommand: () => void }

const Ctx = createContext<CommandCtx | null>(null)

export function CommandProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])
  return <Ctx.Provider value={{ open, setOpen, openCommand: () => setOpen(true) }}>{children}</Ctx.Provider>
}

export function useCommand() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useCommand must be used within CommandProvider")
  return ctx
}
```

- [ ] **Step 2: Create `components/add-command.tsx`**

The palette is stateful: `mode` is `"search"` (iTunes shows+episodes, or an "Add from URL" affordance) or `"episodes"` (a chosen show's / feed's episode list). cmdk's built-in filtering is disabled (`shouldFilter={false}`) — results are driven by our fetches.

```tsx
"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Link2, Loader2 } from "lucide-react"
import { toast } from "sonner"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { useCommand } from "@/components/command-context"
import { isUrl, looksLikeFeedUrl } from "@/lib/url"
import { formatRelativeDate } from "@/lib/format"

type Show = { collectionId: number; name: string; artistName: string; artworkUrl?: string; feedUrl?: string }
type EpisodeResult = {
  trackId: number; collectionId: number; title: string; podcastName: string
  audioUrl?: string; artworkUrl?: string; feedUrl?: string; releaseDate?: string; durationSec?: number
}
type FeedEpisode = {
  title: string; guid?: string; audioUrl: string; publishedAt?: string; durationSec?: number
}

function Thumb({ src, alt }: { src?: string; alt: string }) {
  if (!src) return <div className="size-9 shrink-0 rounded bg-muted" aria-hidden />
  return <img src={src} alt={alt} className="size-9 shrink-0 rounded object-cover" />
}

export function AddCommand() {
  const router = useRouter()
  const { open, setOpen } = useCommand()

  const [query, setQuery] = useState("")
  const [mode, setMode] = useState<"search" | "episodes">("search")
  const [shows, setShows] = useState<Show[]>([])
  const [episodes, setEpisodes] = useState<EpisodeResult[]>([])
  const [feedEpisodes, setFeedEpisodes] = useState<FeedEpisode[]>([])
  const [context, setContext] = useState<{ name?: string; artworkUrl?: string; feedUrl?: string }>({})
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset transient state whenever the dialog closes.
  useEffect(() => {
    if (!open) {
      setQuery(""); setMode("search"); setShows([]); setEpisodes([]); setFeedEpisodes([]); setContext({})
    }
  }, [open])

  // Debounced iTunes search in "search" mode.
  useEffect(() => {
    if (mode !== "search") return
    if (debounce.current) clearTimeout(debounce.current)
    const q = query.trim()
    if (q.length < 2 || isUrl(q)) { setShows([]); setEpisodes([]); return }
    debounce.current = setTimeout(async () => {
      setLoading(true)
      try {
        const [showRes, epRes] = await Promise.all([
          fetch(`/api/itunes/search?type=podcast&q=${encodeURIComponent(q)}`).then((r) => r.json()),
          fetch(`/api/itunes/search?type=episode&q=${encodeURIComponent(q)}`).then((r) => r.json()),
        ])
        setShows((showRes.results ?? []).slice(0, 6))
        setEpisodes((epRes.results ?? []).filter((e: EpisodeResult) => e.audioUrl).slice(0, 6))
      } finally {
        setLoading(false)
      }
    }, 350)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [query, mode])

  async function loadShowEpisodes(feedUrl: string, ctx: { name?: string; artworkUrl?: string }) {
    setLoading(true); setMode("episodes"); setContext({ ...ctx, feedUrl })
    try {
      const data = await fetch(`/api/itunes/episodes?feedUrl=${encodeURIComponent(feedUrl)}`).then((r) => r.json())
      setContext({ name: ctx.name ?? data.showName, artworkUrl: ctx.artworkUrl ?? data.artworkUrl, feedUrl })
      setFeedEpisodes((data.episodes ?? []).slice(0, 30))
    } catch {
      toast.error("Couldn't load that feed")
      setMode("search")
    } finally {
      setLoading(false)
    }
  }

  async function ingest(payload: Record<string, unknown>) {
    setSubmitting(true)
    try {
      const res = await fetch("/api/episodes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to add")
      const { episode } = await res.json()
      toast.success("Episode queued for transcription")
      setOpen(false)
      router.push(`/episodes/${episode.id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add")
    } finally {
      setSubmitting(false)
    }
  }

  const urlQuery = isUrl(query.trim()) ? query.trim() : null

  return (
    <CommandDialog open={open} onOpenChange={setOpen} shouldFilter={false}>
      <CommandInput
        placeholder={mode === "episodes" ? "Filter episodes…" : "Search podcasts, episodes, or paste a URL…"}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {loading && (
          <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        )}

        {mode === "search" && (
          <>
            {!loading && query.trim().length < 2 && (
              <CommandEmpty>Type to search Apple Podcasts, or paste an episode/feed URL.</CommandEmpty>
            )}

            {urlQuery && (
              <CommandGroup heading="URL">
                <CommandItem
                  value={`url-${urlQuery}`}
                  disabled={submitting}
                  onSelect={() => {
                    if (looksLikeFeedUrl(urlQuery)) {
                      loadShowEpisodes(urlQuery, {})
                    } else {
                      ingest({ title: urlQuery, audioUrl: urlQuery, sourceUrl: urlQuery })
                    }
                  }}
                >
                  <Link2 className="size-4" />
                  {looksLikeFeedUrl(urlQuery) ? "Load feed episodes" : "Add this audio URL"}
                </CommandItem>
              </CommandGroup>
            )}

            {shows.length > 0 && (
              <CommandGroup heading="Shows">
                {shows.map((s) => (
                  <CommandItem
                    key={`show-${s.collectionId}`}
                    value={`show-${s.collectionId}`}
                    disabled={!s.feedUrl}
                    onSelect={() => s.feedUrl && loadShowEpisodes(s.feedUrl, { name: s.name, artworkUrl: s.artworkUrl })}
                  >
                    <Thumb src={s.artworkUrl} alt={s.name} />
                    <div className="min-w-0">
                      <div className="truncate">{s.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{s.artistName}</div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {episodes.length > 0 && (
              <CommandGroup heading="Episodes">
                {episodes.map((e) => (
                  <CommandItem
                    key={`ep-${e.trackId}`}
                    value={`ep-${e.trackId}`}
                    disabled={submitting}
                    onSelect={() =>
                      ingest({
                        title: e.title,
                        audioUrl: e.audioUrl,
                        podcastName: e.podcastName,
                        artworkUrl: e.artworkUrl,
                        publishedAt: e.releaseDate,
                        durationSec: e.durationSec,
                        itunesTrackId: e.trackId,
                        itunesCollectionId: e.collectionId,
                      })
                    }
                  >
                    <Thumb src={e.artworkUrl} alt={e.title} />
                    <div className="min-w-0">
                      <div className="truncate">{e.title}</div>
                      <div className="truncate text-xs text-muted-foreground">{e.podcastName}</div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </>
        )}

        {mode === "episodes" && (
          <>
            <CommandGroup>
              <CommandItem value="__back" onSelect={() => { setMode("search"); setFeedEpisodes([]) }}>
                <ArrowLeft className="size-4" /> Back to search
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading={context.name ?? "Episodes"}>
              {feedEpisodes.map((e, i) => (
                <CommandItem
                  key={`feed-${i}`}
                  value={`feed-${i}-${e.title}`}
                  disabled={submitting || !e.audioUrl}
                  onSelect={() =>
                    ingest({
                      title: e.title,
                      audioUrl: e.audioUrl,
                      podcastName: context.name,
                      artworkUrl: context.artworkUrl,
                      episodeGuid: e.guid,
                      publishedAt: e.publishedAt,
                      durationSec: e.durationSec,
                      sourceUrl: context.feedUrl,
                    })
                  }
                >
                  <Thumb src={context.artworkUrl} alt={e.title} />
                  <div className="min-w-0">
                    <div className="truncate">{e.title}</div>
                    <div className="truncate text-xs text-muted-foreground">{formatRelativeDate(e.publishedAt)}</div>
                  </div>
                </CommandItem>
              ))}
              {!loading && feedEpisodes.length === 0 && <CommandEmpty>No episodes found in this feed.</CommandEmpty>}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: clean. (If `CommandDialog` doesn't accept `shouldFilter`, pass it via the underlying `Command` — check the generated `components/ui/command.tsx`; shadcn's `CommandDialog` forwards extra props to `Command`, which accepts `shouldFilter`.)

- [ ] **Step 4: Commit**

```bash
git add components/command-context.tsx components/add-command.tsx
git commit -m "feat: add ⌘K command palette for discovering and adding episodes"
```

---

## Task 3: AppSidebar + AppHeader

**Files:**
- Create: `components/app-sidebar.tsx`
- Create: `components/app-header.tsx`

- [ ] **Step 1: Create `components/app-sidebar.tsx`**

```tsx
"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { AudioLines, Library, Plus } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { useCommand } from "@/components/command-context"
import { ThemeToggle } from "@/components/theme-toggle"

type RecentEpisode = { id: string; title: string; artworkUrl: string | null }

export function AppSidebar() {
  const pathname = usePathname()
  const { openCommand } = useCommand()
  const [recent, setRecent] = useState<RecentEpisode[]>([])

  useEffect(() => {
    let active = true
    fetch("/api/episodes")
      .then((r) => r.json())
      .then((d) => { if (active) setRecent((d.episodes ?? []).slice(0, 6)) })
      .catch(() => {})
    return () => { active = false }
  }, [pathname])

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link href="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <AudioLines className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Podcast KB</span>
                  <span className="truncate text-xs text-muted-foreground">Knowledge base</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === "/"} tooltip="Library">
                <Link href="/"><Library className="size-4" /><span>Library</span></Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={openCommand} tooltip="Add episode (⌘K)">
                <Plus className="size-4" /><span>Add episode</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {recent.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Recent</SidebarGroupLabel>
            <SidebarMenu>
              {recent.map((e) => (
                <SidebarMenuItem key={e.id}>
                  <SidebarMenuButton asChild isActive={pathname === `/episodes/${e.id}`} tooltip={e.title}>
                    <Link href={`/episodes/${e.id}`}>
                      {e.artworkUrl ? (
                        <img src={e.artworkUrl} alt="" className="size-4 rounded-sm object-cover" />
                      ) : (
                        <div className="size-4 rounded-sm bg-muted" />
                      )}
                      <span className="truncate">{e.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <ThemeToggle />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
```

- [ ] **Step 2: Create `components/app-header.tsx`**

```tsx
"use client"

import { Command } from "lucide-react"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useCommand } from "@/components/command-context"

export type Crumb = { label: string; href?: string }

export function AppHeader({ breadcrumbs }: { breadcrumbs: Crumb[] }) {
  const { openCommand } = useCommand()
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          {breadcrumbs.map((c, i) => {
            const last = i === breadcrumbs.length - 1
            return (
              <span key={i} className="contents">
                <BreadcrumbItem>
                  {last || !c.href ? (
                    <BreadcrumbPage className="truncate max-w-[40ch]">{c.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink href={c.href}>{c.label}</BreadcrumbLink>
                  )}
                </BreadcrumbItem>
                {!last && <BreadcrumbSeparator />}
              </span>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>
      <Button variant="outline" size="sm" className="ml-auto gap-2 text-muted-foreground" onClick={openCommand}>
        <Command className="size-3.5" />
        <span className="hidden sm:inline">Add episode</span>
        <kbd className="hidden rounded bg-muted px-1.5 text-[10px] sm:inline">⌘K</kbd>
      </Button>
    </header>
  )
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm typecheck` (expect clean).
```bash
git add components/app-sidebar.tsx components/app-header.tsx
git commit -m "feat: add app sidebar and header"
```

---

## Task 4: Mount the shell in the root layout

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Update `app/layout.tsx`** to wrap everything in the command provider + sidebar shell (keep fonts, `ThemeProvider`, `Toaster`)

```tsx
import { Geist_Mono, Figtree } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { cn } from "@/lib/utils"
import { CommandProvider } from "@/components/command-context"
import { AddCommand } from "@/components/add-command"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

const figtree = Figtree({ subsets: ["latin"], variable: "--font-sans" })
const fontMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", figtree.variable)}
    >
      <body>
        <ThemeProvider>
          <CommandProvider>
            <SidebarProvider>
              <AppSidebar />
              <SidebarInset>{children}</SidebarInset>
            </SidebarProvider>
            <AddCommand />
          </CommandProvider>
        </ThemeProvider>
        <Toaster />
      </body>
    </html>
  )
}
```

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: success. (The existing pages now render inside the shell; they'll be replaced in Tasks 5–6.)

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "feat: mount sidebar shell and command palette in root layout"
```

---

## Task 5: Library (home) + EpisodeCard

**Files:**
- Create: `components/episode-card.tsx`
- Create: `components/library.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Create `components/episode-card.tsx`**

```tsx
"use client"

import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatRelativeDate } from "@/lib/format"

export type LibEpisode = {
  id: string
  title: string
  podcastName: string | null
  artworkUrl: string | null
  status: string
  publishedAt: string | null
  createdAt: string
}

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "ready") return "default"
  if (status === "failed") return "destructive"
  return "secondary"
}

export function EpisodeCard({ episode }: { episode: LibEpisode }) {
  const inFlight = !["ready", "failed"].includes(episode.status)
  return (
    <Link href={`/episodes/${episode.id}`} className="group">
      <Card className="overflow-hidden p-0 transition-colors hover:border-foreground/20">
        <div className="aspect-square w-full overflow-hidden bg-muted">
          {episode.artworkUrl ? (
            <img
              src={episode.artworkUrl}
              alt=""
              className="size-full object-cover transition-transform group-hover:scale-105"
            />
          ) : null}
        </div>
        <div className="space-y-1 p-3">
          <div className="flex items-start justify-between gap-2">
            <span className="line-clamp-2 text-sm font-medium">{episode.title}</span>
            <Badge variant={statusVariant(episode.status)} className={inFlight ? "animate-pulse" : ""}>
              {episode.status}
            </Badge>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {episode.podcastName} {episode.publishedAt ? `· ${formatRelativeDate(episode.publishedAt)}` : ""}
          </div>
        </div>
      </Card>
    </Link>
  )
}
```

- [ ] **Step 2: Create `components/library.tsx`**

```tsx
"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { EpisodeCard, type LibEpisode } from "@/components/episode-card"
import { useCommand } from "@/components/command-context"
import { formatTimestamp } from "@/lib/format"

type Hit = {
  chunkId: string; episodeId: string; episodeTitle: string
  content: string; startSec: number; endSec: number; similarity: number
}

export function Library({ initialEpisodes }: { initialEpisodes: LibEpisode[] }) {
  const { openCommand } = useCommand()
  const [episodes, setEpisodes] = useState(initialEpisodes)
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Revalidate the archive while anything is still processing.
  useEffect(() => {
    const anyInFlight = episodes.some((e) => !["ready", "failed"].includes(e.status))
    if (!anyInFlight) return
    const t = setInterval(() => {
      fetch("/api/episodes").then((r) => r.json()).then((d) => setEpisodes(d.episodes ?? [])).catch(() => {})
    }, 6000)
    return () => clearInterval(t)
  }, [episodes])

  // Debounced semantic search.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    const q = query.trim()
    if (q.length < 2) { setHits(null); return }
    debounce.current = setTimeout(async () => {
      setSearching(true)
      try {
        const d = await fetch("/api/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: q, limit: 12 }),
        }).then((r) => r.json())
        setHits(d.hits ?? [])
      } finally {
        setSearching(false)
      }
    }, 400)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [query])

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your episodes and transcript moments…"
          className="pl-9"
        />
      </div>

      {hits !== null ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            {searching ? "Searching…" : `${hits.length} moment${hits.length === 1 ? "" : "s"}`}
          </h2>
          {hits.map((h) => (
            <Link key={h.chunkId} href={`/episodes/${h.episodeId}`}>
              <Card className="p-3 transition-colors hover:border-foreground/20">
                <div className="text-xs text-muted-foreground">
                  {h.episodeTitle} · [{formatTimestamp(h.startSec)}]
                </div>
                <p className="mt-1 line-clamp-3 text-sm">{h.content}</p>
              </Card>
            </Link>
          ))}
          {!searching && hits.length === 0 && (
            <p className="text-sm text-muted-foreground">No matching moments found.</p>
          )}
        </section>
      ) : episodes.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-center">
          <p className="text-muted-foreground">No episodes yet.</p>
          <Button onClick={openCommand}>Add your first episode</Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {episodes.map((e) => (
            <EpisodeCard key={e.id} episode={e} />
          ))}
        </div>
      )}
    </div>
  )
}
```

> The `searching` flag drives a "Searching…" label; the page server-fetches the initial grid, so no grid skeleton component is needed here.

- [ ] **Step 3: Replace `app/page.tsx`**

```tsx
import { episodeRepo } from "@/lib/db/episodes"
import { AppHeader } from "@/components/app-header"
import { Library } from "@/components/library"
import type { LibEpisode } from "@/components/episode-card"

export const dynamic = "force-dynamic"

export default async function Page() {
  const rows = await episodeRepo.list()
  const episodes: LibEpisode[] = rows.map((e) => ({
    id: e.id,
    title: e.title,
    podcastName: e.podcastName,
    artworkUrl: e.artworkUrl,
    status: e.status,
    publishedAt: e.publishedAt ? e.publishedAt.toISOString() : null,
    createdAt: e.createdAt.toISOString(),
  }))
  return (
    <>
      <AppHeader breadcrumbs={[{ label: "Library" }]} />
      <Library initialEpisodes={episodes} />
    </>
  )
}
```

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add components/episode-card.tsx components/library.tsx app/page.tsx
git commit -m "feat: add Library home with episode grid and integrated search"
```

---

## Task 6: Episode detail restyle

**Files:**
- Create: `components/episode-view.tsx`
- Modify: `components/episode-chat.tsx`
- Modify: `app/episodes/[id]/page.tsx`

- [ ] **Step 1: Simplify `components/episode-chat.tsx`** to drop its outer card/heading (it now lives inside a tab) — keep the streaming logic identical

```tsx
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function EpisodeChat({ episodeId }: { episodeId: string }) {
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState("")
  const [busy, setBusy] = useState(false)

  async function ask() {
    setBusy(true)
    setAnswer("")
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, episodeId }),
      })
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          setAnswer((prev) => prev + decoder.decode(value))
        }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What did they say about…?"
          onKeyDown={(e) => e.key === "Enter" && !busy && question && ask()}
        />
        <Button onClick={ask} disabled={busy || !question}>Ask</Button>
      </div>
      {answer && <p className="text-sm whitespace-pre-wrap leading-relaxed">{answer}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Create `components/episode-view.tsx`**

```tsx
"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EpisodeChat } from "@/components/episode-chat"
import { formatRelativeDate, formatTimestamp } from "@/lib/format"

type Segment = { start: number; end: number; text: string }
type Insights = {
  summary?: string | null
  takeaways?: string[] | null
  topics?: string[] | null
  quotes?: { text: string; approxTimestampSec: number }[] | null
  entities?: { name: string; type: string }[] | null
} | null

export type EpisodeViewProps = {
  episode: {
    id: string; title: string; podcastName: string | null; artworkUrl: string | null
    status: string; errorMessage: string | null; publishedAt: string | null
  }
  transcript: { fullText: string; segments: Segment[] } | null
  insights: Insights
}

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "ready") return "default"
  if (status === "failed") return "destructive"
  return "secondary"
}

export function EpisodeView({ episode, transcript, insights }: EpisodeViewProps) {
  const router = useRouter()
  const inFlight = !["ready", "failed"].includes(episode.status)

  useEffect(() => {
    if (!inFlight) return
    const t = setInterval(() => router.refresh(), 4000)
    return () => clearInterval(t)
  }, [inFlight, router])

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex gap-4">
        <div className="size-24 shrink-0 overflow-hidden rounded-lg bg-muted md:size-32">
          {episode.artworkUrl ? <img src={episode.artworkUrl} alt="" className="size-full object-cover" /> : null}
        </div>
        <div className="min-w-0 space-y-2">
          <h1 className="text-xl font-semibold md:text-2xl">{episode.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {episode.podcastName && <span>{episode.podcastName}</span>}
            {episode.publishedAt && <span>· {formatRelativeDate(episode.publishedAt)}</span>}
            <Badge variant={statusVariant(episode.status)} className={inFlight ? "animate-pulse" : ""}>
              {episode.status}
            </Badge>
          </div>
          {episode.status === "failed" && (
            <div className="space-y-1">
              <p className="text-sm text-destructive">{episode.errorMessage}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await fetch(`/api/episodes/${episode.id}/retry`, { method: "POST" })
                  router.refresh()
                }}
              >
                Retry
              </Button>
            </div>
          )}
          {inFlight && <p className="text-sm text-muted-foreground">Processing… this page updates automatically.</p>}
        </div>
      </div>

      {transcript ? (
        <Tabs defaultValue="insights" className="w-full">
          <TabsList>
            <TabsTrigger value="insights">Insights</TabsTrigger>
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
            <TabsTrigger value="ask">Ask</TabsTrigger>
          </TabsList>

          <TabsContent value="insights" className="space-y-4 pt-2">
            {insights?.summary && <p className="text-sm leading-relaxed">{insights.summary}</p>}
            {insights?.takeaways?.length ? (
              <div>
                <h3 className="mb-1 text-sm font-medium">Takeaways</h3>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {insights.takeaways.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </div>
            ) : null}
            {insights?.topics?.length ? (
              <div className="flex flex-wrap gap-1">
                {insights.topics.map((t, i) => <Badge key={i} variant="secondary">{t}</Badge>)}
              </div>
            ) : null}
            {insights?.quotes?.length ? (
              <div className="space-y-2">
                {insights.quotes.map((q, i) => (
                  <blockquote key={i} className="border-l-2 pl-3 text-sm italic">
                    “{q.text}” <span className="text-muted-foreground">[{formatTimestamp(q.approxTimestampSec)}]</span>
                  </blockquote>
                ))}
              </div>
            ) : null}
            {insights?.entities?.length ? (
              <div className="flex flex-wrap gap-1">
                {insights.entities.map((e, i) => <Badge key={i} variant="outline">{e.name}</Badge>)}
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="transcript" className="pt-2">
            <ScrollArea className="h-[60vh] rounded-md border p-4">
              <div className="space-y-1 text-sm">
                {transcript.segments.map((s, i) => (
                  <p key={i}>
                    <span className="mr-2 tabular-nums text-muted-foreground">{formatTimestamp(s.start)}</span>
                    {s.text}
                  </p>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="ask" className="pt-2">
            <EpisodeChat episodeId={episode.id} />
          </TabsContent>
        </Tabs>
      ) : (
        <p className="text-sm text-muted-foreground">
          {episode.status === "failed" ? "Processing failed." : "Transcript will appear here once processing finishes."}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Replace `app/episodes/[id]/page.tsx`**

```tsx
import { notFound } from "next/navigation"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { episodeRepo } from "@/lib/db/episodes"
import { insights as insightsTable, transcripts as transcriptsTable } from "@/lib/db/schema"
import { AppHeader } from "@/components/app-header"
import { EpisodeView } from "@/components/episode-view"

export const dynamic = "force-dynamic"

export default async function EpisodePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const episode = await episodeRepo.getById(id)
  if (!episode) notFound()

  const [transcript] = await db.select().from(transcriptsTable).where(eq(transcriptsTable.episodeId, id)).limit(1)
  const [insight] = await db.select().from(insightsTable).where(eq(insightsTable.episodeId, id)).limit(1)

  return (
    <>
      <AppHeader breadcrumbs={[{ label: "Library", href: "/" }, { label: episode.title }]} />
      <EpisodeView
        episode={{
          id: episode.id,
          title: episode.title,
          podcastName: episode.podcastName,
          artworkUrl: episode.artworkUrl,
          status: episode.status,
          errorMessage: episode.errorMessage,
          publishedAt: episode.publishedAt ? episode.publishedAt.toISOString() : null,
        }}
        transcript={transcript ? { fullText: transcript.fullText, segments: transcript.segments ?? [] } : null}
        insights={insight ?? null}
      />
    </>
  )
}
```

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add components/episode-view.tsx components/episode-chat.tsx "app/episodes/[id]/page.tsx"
git commit -m "feat: restyle episode detail with hero and tabs"
```

---

## Task 7: Remove superseded pages/components + final verification

**Files:**
- Delete: `app/episodes/page.tsx`, `app/search/page.tsx`, `components/add-episode.tsx`, `components/global-search.tsx`, `components/episode-detail.tsx`

- [ ] **Step 1: Delete the superseded files**

```bash
git rm app/episodes/page.tsx app/search/page.tsx components/add-episode.tsx components/global-search.tsx components/episode-detail.tsx
```
Note: `app/episodes/` no longer has a `page.tsx`, only `[id]/page.tsx` — that's fine (no index route at `/episodes`).

- [ ] **Step 2: Check for dangling references**

Run: `grep -rn "add-episode\|global-search\|episode-detail\|/search\|/episodes\"" app components` (excluding `episodes/[id]`).
Expected: no imports of the deleted components remain. The only `/episodes/...` references should be `href={`/episodes/${id}`}` links (valid). Fix any leftover import.

- [ ] **Step 3: Full verification**

Run: `pnpm test` — expect all pass (helpers + existing suite).
Run: `pnpm typecheck` — expect clean.
Run: `pnpm build` — expect success, and confirm the route list shows `/` and `/episodes/[id]` but no `/search` or `/episodes`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove pages/components superseded by the redesign"
```

- [ ] **Step 5: Manual smoke (local)**

Run `pnpm dev`, then verify: Library grid renders with artwork; ⌘K opens; searching a show lists shows with thumbnails; selecting a show drills into its episodes; adding navigates to the detail page; the detail tabs (Insights/Transcript/Ask) work; typing in the Library search returns transcript moments; theme toggle flips light/dark; sidebar collapses.

---

## Notes
- Use the `frontend-design` skill while implementing the visual components (Tasks 3, 5, 6) for polish, and the `shadcn` skill for Task 1 component setup.
- Keep all colors as theme tokens (`bg-muted`, `text-muted-foreground`, `border`, etc.) — no hardcoded hex.
- Artwork uses plain `<img>`; always pass `alt` (empty `alt=""` for decorative covers) and rely on the `bg-muted` box as the fallback when `artworkUrl` is null.
