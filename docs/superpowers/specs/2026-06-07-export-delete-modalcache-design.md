# Episode Export + Delete + Modal Cache — Design Spec

**Date:** 2026-06-07
**Status:** Approved for implementation

Three focused additions: delete an episode from the UI, export an episode to Markdown (download + copy), and cache the Whisper model weights in a Modal Volume for faster/cheaper cold starts.

---

## Decisions locked in

| Area | Decision |
|---|---|
| Export delivery | Download `.md` file **and** copy-to-clipboard |
| Export format | **Plain markdown**, no YAML frontmatter, no `#tag`/`[[link]]` syntax |
| Delete UX | Confirm **AlertDialog** on the episode detail page; permanent |
| Modal cache | Whisper weights cached in a Modal **Volume** (download once, reuse) |

---

## 1. Modal model caching

**Goal:** stop re-downloading the ~3 GB `large-v3` weights on every cold start.

**Approach (`modal/transcribe.py`):**
- Create a named Volume: `model_cache = modal.Volume.from_name("whisper-cache", create_if_missing=True)`.
- Mount it on the `transcribe` function at `/cache` (`volumes={"/cache": model_cache}`).
- Load the model with `WhisperModel("large-v3", device="cuda", compute_type="float16", download_root="/cache")` so weights live in the Volume.
- `model_cache.reload()` at the start (pick up existing cache) and `model_cache.commit()` after the model loads (persist a freshly downloaded snapshot). The `web` endpoint (which only spawns) does not need the Volume.

**Cost:** lowers total Modal usage (no repeated GPU-seconds spent downloading); adds ~$0.50/mo of Volume storage, which draws from the $30/mo Modal credit (so still effectively free at ~1 episode/day). We do **not** keep GPU containers warm (that would be expensive).

**What you do in Modal:** essentially nothing manual.
1. After the code change, run **`modal deploy modal/transcribe.py`** (same as before). The Volume `whisper-cache` is created automatically by `create_if_missing=True` — no dashboard step.
2. The **first** transcription after deploy still downloads the model once (into the Volume) — that run is the usual slower one. Every run after that loads from the cache and is fast.
That's it — no Modal dashboard configuration needed.

## 2. Delete an episode

- **Repo:** add `episodeRepo.remove(id)` → `delete from episodes where id` (cascades to transcripts, insights, chunks, and the episode's conversations/messages via existing FKs).
- **API:** `DELETE /api/episodes/:id` → remove, return `{ status: "deleted" }`.
- **UI:** an actions control in the episode detail header. Clicking **Delete** opens a shadcn `AlertDialog` ("Delete this episode? This permanently removes its transcript, insights, and chats. This can't be undone."). On confirm → `DELETE` → toast → `router.push("/")` (back to Library). Cancel closes.

## 3. Export to Markdown

- **Pure builder** `lib/export/episode-markdown.ts` → `buildEpisodeMarkdown(episode, transcript, insights): string`. Plain markdown:
  ```
  # {title}
  {podcastName} · {runtime} · {date}        (only the parts that exist)
  Source: {sourceUrl}                         (if present)

  ## Summary
  {summary}

  ## Takeaways
  - {takeaway}

  ## Topics
  {topic}, {topic}, …

  ## Notable quotes
  > "{quote}" — [mm:ss]

  ## People & entities
  {name} ({type}), …

  ## Transcript
  [0:00] {segment text}
  [1:05] …
  ```
  Sections with no data are omitted. Timestamps via the existing `formatTimestamp`.
- **UI:** in the same detail-header actions control, **Copy markdown** (clipboard + toast) and **Download .md** (Blob → anchor download; filename = slugified title + `.md`). Both call the shared builder with the already-loaded episode/transcript/insights.

## 4. Components / files

- `modal/transcribe.py` (Volume + cached load) — redeployed by the user.
- `lib/db/episodes.ts` (+`remove`).
- `app/api/episodes/[id]/route.ts` (+`DELETE`).
- `lib/export/episode-markdown.ts` (`buildEpisodeMarkdown`) + `lib/export/slug.ts` (or inline `slugify`).
- `components/episode-actions.tsx` (new client component: a `DropdownMenu` with Copy / Download / Delete, plus the `AlertDialog`). Add shadcn `alert-dialog`.
- `components/episode-view.tsx` (render `<EpisodeActions … />` in the header; pass `episode`, `transcript`, `insights`).

## 5. Testing

- Vitest (pure): `buildEpisodeMarkdown` — includes title/meta/summary/takeaways/quotes/transcript; omits empty sections; timestamps formatted. `slugify` basic cases.
- Vitest (DB, `podcast_kb_test`): `DELETE /api/episodes/:id` removes the episode and cascades (transcript/insights/chunks gone).
- Modal cache: verified manually at deploy (first run downloads, second run fast — confirm via Modal logs).
- UI: `pnpm typecheck` + `pnpm build` + manual smoke (copy, download opens a file, delete → confirm → returns to Library).

## 6. Build order
1. `buildEpisodeMarkdown` + `slugify` + tests.
2. `episodeRepo.remove` + `DELETE` route + test.
3. `EpisodeActions` component (+ shadcn alert-dialog) and wire into `episode-view` header.
4. Modal `transcribe.py` caching (user redeploys).
5. Verify + push/deploy.

## 7. Notes
- No DB migration (only a new repo method + existing cascades).
- Deleting the currently-playing episode leaves the global player loaded with that audio URL (still plays from the CDN); not worth special-casing for a personal app.
- Theme tokens only; AlertDialog/DropdownMenu are shadcn.
