# UI Redesign — Design Spec

**Date:** 2026-06-05
**Status:** Approved for implementation

Rebuild the frontend of the Podcast Knowledge Base as an app-like dashboard: a persistent sidebar shell, a unified Library (archive + semantic search), a ⌘K command palette for discovering and adding episodes (with artwork and show→episode drill-down), and a restyled episode detail page. No backend/API changes.

Builds on the original app (`docs/superpowers/specs/2026-06-05-podcast-knowledge-base-design.md`). Uses native shadcn/ui patterns (style `radix-rhea`, baseColor `mist`, lucide icons).

---

## Decisions locked in

| Area | Decision |
|---|---|
| Shell | shadcn sidebar dashboard pattern, adapted (no team-switcher / billing / account) |
| Home | **Library**: artwork grid of episodes + integrated search bar (empty = browse archive, query = semantic transcript search) |
| Add/discover | **⌘K command palette** with show→episode drill-down, artwork thumbnails, and paste-URL support |
| Theme toggle | Sidebar footer (`next-themes`, already wired) |
| Episode detail | Restyled in-shell; `Tabs` for Insights / Transcript / Ask |
| Artwork | Plain `<img>` (no `next/image` domain config) |
| API | No changes — frontend rebuild on existing endpoints |

---

## 1. App shell

In the root layout: `SidebarProvider` → `AppSidebar collapsible="icon"` → `SidebarInset`. Page content renders inside the inset and begins with a header: `SidebarTrigger` + vertical `Separator` + `Breadcrumb`, with the ⌘K trigger on the right.

**AppSidebar** (`components/app-sidebar.tsx`, client):
- **Header:** brand — lucide `AudioLines` icon + "Podcast KB".
- **Content:**
  - Main nav (`SidebarMenu`): *Library* → `/`; *Add episode* → opens the ⌘K palette.
  - Recent group: last ~6 episodes (artwork thumb + title) linking to detail; fetched client-side from `GET /api/episodes` so it stays current.
- **Footer:** `ThemeToggle`.
- `SidebarRail`.

The ⌘K palette must be openable from the sidebar item, the header button, and the keyboard shortcut. A small client context (`components/command-context.tsx`) exposes `open()`/state via `useCommand()`; the provider sits in the shell and renders `<AddCommand>`.

## 2. Library (home `/`)

`components/library.tsx` (client):
- Search `Input` at top. Debounced. **Empty query** → episode grid. **Non-empty** → `POST /api/search` and render moments.
- **Grid:** responsive (`grid` 1/2/3/4 cols by breakpoint) of `EpisodeCard` (`components/episode-card.tsx`): artwork (cover, object-cover, fallback placeholder), title, show name, relative date, status `Badge`. Links to `/episodes/[id]`.
- **Search results:** list of moments — episode artwork thumb + title + `[mm:ss]` (via `formatTimestamp`) + content snippet — each linking to the episode.
- **In-flight episodes** (status not `ready`/`failed`) show a muted/animated badge; the grid revalidates every few seconds (e.g. `setInterval` re-fetch) so they flip to `ready` automatically.
- **Loading:** `Skeleton` cards. **Empty state:** "No episodes yet — press ⌘K to add one" with a button that opens the palette.

Initial episode list is fetched in the page (server component, `GET` via `episodeRepo.list()`) and passed to `Library`; client revalidation uses `GET /api/episodes`.

## 3. ⌘K add/discover palette

`components/add-command.tsx` (client) — a shadcn `CommandDialog` with internal step state:

- **State:** `mode` (`search` | `show-episodes` | `url-episodes`), `query`, current `show`, async results, loading flags.
- **search mode:** typing queries `GET /api/itunes/search?type=podcast` and `?type=episode` (in parallel, debounced); render two `CommandGroup`s — **Shows** and **Episodes** — each item with an artwork thumbnail (`<img>` 32–40px). If the query is detected as a URL (`isUrl` helper), surface an "Add from URL" item instead/above.
- **Selecting a show** → `show-episodes` mode: fetch `GET /api/itunes/episodes?feedUrl=…`, list episodes (artwork + title + date); a back affordance returns to search.
- **Selecting an episode** (from either episode results or a show's list) → ingest.
- **Add from URL:** RSS feed URL → `url-episodes` (list feed episodes); direct audio URL → ingest with the URL as a fallback title.
- **Ingest:** `POST /api/episodes` with the normalized payload (title, audioUrl, podcastName, artworkUrl, episodeGuid, publishedAt, durationSec, sourceUrl) → success toast → close palette → `router.push('/episodes/{id}')`. Disable selection when an item has no usable `audioUrl`.
- Global ⌘K / Ctrl-K listener toggles the dialog.

## 4. Episode detail (`/episodes/[id]`)

`components/episode-view.tsx` (client) replaces `episode-detail.tsx`; keeps `episode-chat.tsx` (restyled). Page (server) fetches episode + transcript + insights as today and passes them in.
- Header breadcrumb: *Library / {title}*.
- Hero: artwork, title, show, date, status `Badge`; on `failed`, error text + Retry button (`POST /api/episodes/[id]/retry`).
- `Tabs`:
  - **Insights:** summary, takeaways (list), topics (badges), quotes (blockquotes with timestamps), entities.
  - **Transcript:** timestamped lines inside a `ScrollArea`.
  - **Ask:** the grounded chat (`EpisodeChat`).
- Polling: while status is in-flight, `router.refresh()` every 4s (existing behavior).

## 5. Components & files

**Add (shadcn):** `sidebar`, `breadcrumb`, `separator`, `command`, `dialog`, `skeleton`, `scroll-area`, `tooltip`, `dropdown-menu`, `avatar`.

**Create:** `components/app-sidebar.tsx`, `components/theme-toggle.tsx`, `components/app-header.tsx`, `components/command-context.tsx`, `components/add-command.tsx`, `components/library.tsx`, `components/episode-card.tsx`, `components/episode-view.tsx`. Helpers: `lib/url.ts` (`isUrl`, `looksLikeFeedUrl`), extend `lib/format.ts` (`formatRelativeDate`).

**Modify:** `app/layout.tsx` (mount shell + command provider), `app/page.tsx` (Library), `app/episodes/[id]/page.tsx` (use `EpisodeView`).

**Delete:** `app/episodes/page.tsx`, `app/search/page.tsx`, `components/add-episode.tsx`, `components/global-search.tsx`, `components/episode-detail.tsx`.

## 6. Look & feel

- Native shadcn composition; theme tokens only (no hardcoded colors); spacing/typography consistent with the components.
- Artwork: `<img>` with `object-cover`, rounded, fixed aspect; `onError` → neutral placeholder (icon on `bg-muted`).
- Responsive: sidebar collapses to icons; grid reflows; palette and tabs work on mobile.
- Accessibility: command items keyboard-navigable; buttons labelled; images have `alt`.

## 7. Testing & verification

- Unit tests (Vitest) for pure helpers: `lib/url.ts` (`isUrl`, `looksLikeFeedUrl`) and `formatRelativeDate`.
- `pnpm typecheck` clean and `pnpm build` green are the primary gates for the UI.
- Manual smoke after build: load Library, open ⌘K, search a show, drill into episodes, add one, view detail tabs, run a semantic search.

## 8. Out of scope

- Backend/API/schema changes.
- Timestamp deep-linking into the transcript from a search moment (link to the episode is enough for now).
- Auth, multi-user, settings pages.
