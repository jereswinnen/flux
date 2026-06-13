# Frontend Polish & DRY (SP3 + SP4) — Design

**Date:** 2026-06-13
**Status:** Approved design, ready for implementation planning

**Context:** The final two sub-projects of the hardening sweep (SP1 DB hygiene, SP2 API+rename done). Frontend-only; lower-risk. SP3 = UX quick wins; SP4 = shared-component DRY. Done together (SP3 first, then SP4 extracts from the now-final markup) to avoid touching the same files twice.

## SP3 — UX quick wins

1. **Sidebar Search link** (`components/app-sidebar.tsx`): add a `SidebarMenuButton` linking `/search` (lucide `Search` icon, `isActive={pathname === "/search"}`, `tooltip="Search"`), placed between the Ask and Highlights items, matching the existing nav-item markup.

2. **Mobile touch actions** — hover-only action affordances are invisible on touch. Add `pointer-coarse:opacity-100 group-focus-within:opacity-100` alongside the existing `group-hover:opacity-100` on:
   - `components/highlights-feed.tsx:94` (delete)
   - `components/conversation-menu.tsx:78` and `components/conversation-list.tsx:77` (rename/delete)
   - `components/video-player.tsx:338` (close/expand cluster) and `:392` (scrub overlay — but it already has `data-[paused=true]:opacity-100`; add `pointer-coarse:opacity-100` so controls are reachable on touch)
   - `components/chat-message.tsx:272,290` (source Play icons)

3. **Scrubber touch-drag** (`components/global-player.tsx:81`, `components/video-player.tsx:429`): replace the mouse-only `onClick={onScrub}` with pointer-based drag — `onPointerDown` (seek + begin drag, `setPointerCapture`), `onPointerMove` (while dragging, seek), `onPointerUp` (end). Reuse the existing clientX→fraction math from `onScrub`. Works for mouse + touch + pen.

4. **Mini-player width** (`components/video-player.tsx`): the docked mini player is a fixed `w-72`. Add `max-w-[calc(100vw-2rem)]` so it never exceeds the viewport on a phone.

5. **Error / empty states**:
   - `components/search-view.tsx:152`: the `/api/answer` `.catch(() => {})` swallows failures (perpetual loading). Add an `error` state; on failure show "Couldn't search — try again." in place of the answer block; clear it on a new query.
   - `components/use-conversation.ts:163`: a failed chat stream only toasts and leaves an empty assistant bubble. In the catch (non-abort), set the last assistant message's content to an inline error (e.g. `"⚠️ Something went wrong. Please try again."`) so it persists in the thread; keep the toast.
   - `components/ask-view.tsx:55`: the `/api/items` `.catch(() => {})` for the @-mention list — add a `toast.error` so a failure isn't fully silent (the picker/`?attach=` deep link would otherwise break invisibly).

6. **Article lead image** (`components/item-view.tsx:172`): add `onError={(e) => { e.currentTarget.style.display = "none" }}` to the hero `<img>` so a dead hotlinked OG image hides instead of collapsing the `aspect-video` box.

## SP4 — shared-component DRY

1. **`statusVariant`** — identical fn in `components/item-card.tsx:18` and `components/item-view.tsx:193`. Extract to `lib/item-status.ts` (`export function statusVariant(status: string): "default" | "secondary" | "destructive"`), import in both.

2. **`hostname`** — `components/use-conversation.ts:7` duplicates `hostname` already exported from `lib/ai/web-sources.ts:12`. Import from there; delete the local copy.

3. **`StatusBadge`** (`components/status-badge.tsx`) — extract the item-view status `<Badge>` (the one that shows status text + `animate-pulse` while in-flight) into a small component taking `status`. Use `statusVariant` internally. Replace the inline usage in `item-view.tsx`.

4. **`StickyTabBar`** (`components/sticky-tab-bar.tsx`) — the sticky tab-bar wrapper `<div className="sticky top-0 z-10 -mx-4 mb-2 bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:px-6"><TabsList>…</TabsList></div>` is inlined 3× in `item-view.tsx` (article/youtube/podcast). Extract a component that wraps `children` (the `TabsList`). Use it in all three branches.

5. **`SourceBadge`** (`components/source-badge.tsx`) — the "Highlight" (primary) and "Web" (sky) pills are rendered with identical inline classes in both `chat-message.tsx` and `search-view.tsx`. Extract `<SourceBadge kind="highlight" | "web" />`. Replace both usages in both files.

**Deliberately NOT in scope:** unifying the two source-*card* grouping algorithms (chat = group-by-episode + dropdown; search = its own grouping). They're entangled and the gain is small; only the shared *primitives* above are extracted.

## Error handling / behavior

All SP3 changes are additive/defensive (new affordances, fallbacks, error displays) — no behavior removed. SP4 is pure refactor — extracted components must render byte-identical markup (verified by build + visual parity).

## Testing

- **Unit:** none strictly required (UI/CSS + refactor); optionally a tiny `statusVariant` test.
- **Build + typecheck + lint** at the 11-error baseline after each task group.
- **Manual:** mobile (touch) — actions visible, scrubber drags, mini-player fits; search error path; chat error injects a message; article with a dead image; the new sidebar Search link; the three tab bars + source badges look unchanged after extraction.
- Full suite stays green (159).

## Scope
**In:** the six SP3 fixes + the five SP4 extractions/dedups above.
**Out:** full SourceCard grouping unification; any API/data change; new tests beyond an optional `statusVariant` unit test.
