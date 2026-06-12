# YouTube Transcription — Design

**Date:** 2026-06-12
**Status:** Approved design, ready for implementation planning

## Summary

Add the ability to "give the app" a YouTube video URL and have it transcribed,
analyzed, and rendered the same way podcasts are today — with a video-at-top
detail page and a **live-reading transcript** that follows playback. This work
also generalizes the current podcast-only data model into a **modular,
multi-source content model** (podcast, YouTube, and future: web articles,
Kindle highlights) with a **clean API layer** suitable for a future native iOS
client.

The transcription core is unchanged: a YouTube video's audio is fed to the same
faster-whisper `large-v3` job on Modal that podcasts use, producing the
identical `{fullText, segments}` shape. Everything downstream (insights,
chunking/embeddings, entity resolution) runs untouched.

## Goals

- Ingest a single YouTube video URL → fully analyzed content item.
- Always transcribe with Whisper (`large-v3`) for quality consistency with
  podcasts. No reliance on YouTube captions.
- No reliance on any third-party transcript/extraction API.
- "Set and done" maintenance: no servers to run, no metered proxies, no API
  keys to manage.
- Generalize the data model so new sources are "just another adapter."
- Expose a clean DTO/API boundary so a future iOS app can consume the same data.

## Non-Goals (this milestone)

- Playlists and channel ingestion (single video only to start).
- Web article / Kindle highlight ingestion (design accommodates them; not built).
- Migrating existing podcast data (clean schema rewrite; data loss is acceptable).
- Authentication on the JSON API (the endpoint boundary is where it would slot
  in later).
- Speaker diarization (same as current podcast flow — not present).

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Data model | Polymorphic `items` table (Option 1: shared columns + `sourceMetadata` JSONB) | Clean queries on common fields, flexible per-type extras, article-ready |
| Existing podcast data | Clean schema rewrite, drop existing rows | User OK'd data loss; removes the risky data-migration step |
| Transcript source | Always Whisper `large-v3` | Quality + consistency with podcasts; same per-hour cost as podcasts |
| YouTube egress | Cloudflare WARP via `wgcf` + `wireproxy` (userspace) inside Modal | YouTube does not blacklist Cloudflare IPs; userspace avoids TUN/NET_ADMIN; free, no third party |
| Metadata source | `yt-dlp` (inside the Modal job) | No YouTube Data API key to manage |
| Ingest scope | Single video URL only | YAGNI; mirrors podcast-add flow |
| Detail layout | Layout A: video pinned on top, Live Transcript / Insights tabs below | Closest to current episode page, mobile-friendly |
| Video on scroll | Docks to a **bottom-right** mini-player, keeps playing | Familiar pattern; keeps transcript synced while scrolling |

## Egress: why WARP-on-Modal (verified June 2026)

- Running `yt-dlp` directly from a datacenter IP (Modal **or** Vercel) hits
  YouTube's "Sign in to confirm you're not a bot" wall — datacenter ranges are
  auto-flagged, often after only a handful of requests.
- **YouTube does not blacklist Cloudflare's IP ranges.** Routing egress through
  Cloudflare WARP yields an IP YouTube treats as a normal client.
- Inside Modal's locked-down container we cannot rely on a TUN device or
  `NET_ADMIN`. Therefore we use a **fully userspace** path: `wgcf` mints a WARP
  WireGuard config; `wireproxy` runs it via userspace netstack and exposes a
  local SOCKS5 proxy; `yt-dlp --proxy socks5://127.0.0.1:…` uses it.
- **Caveats (eyes-open):** WARP is free "for now"; Cloudflare or YouTube could
  change posture. Mitigations: a runtime health gate, pinned `yt-dlp`, and clean
  retryable failures. Shared WARP exit IPs could draw rate-limiting at high
  volume — not a concern at personal-ingestion scale.

## Architecture

### Modular by source: `SourceAdapter`

Every source implements one small contract; everything after ingestion is shared.

```
SourceAdapter
  detect(input)        → does this adapter handle this URL/file/import?
  resolve(input)       → normalized item metadata (title, thumbnail, duration, publishedAt, sourceMetadata)
  produceContent(item) → yields { fullText, segments } by whatever means the source needs
```

- **podcast** → audio URL → Modal Whisper (existing)
- **youtube** → `yt-dlp` (WARP) extracts audio → Modal Whisper (new)
- **article** (future) → fetch + readability extraction → text directly, no Modal
- **kindle** (future) → parse highlights export → text directly, no Modal

**Shared content pipeline** (source-agnostic; today's `process-transcript.ts`,
generalized to `process-content.ts`): `{fullText, segments}` → store transcript
→ generate insights → chunk + embed → resolve entities → status `ready`.

Text-only sources have **no audio timestamps**, so `segments` is nullable and
timestamp-dependent features (live-reading sync, chapter/quote seeks) are
features of *timestamped* sources, not assumptions in the core.

### Modular by consumer: DTO layer + JSON API

- **One serialization layer** in `lib/api/`: `item → ItemDTO`,
  `insights → InsightsDTO`, etc. Both Next.js server components and JSON
  endpoints use the same mappers, so web and a future iOS app see identical,
  stable shapes.
- **Resource endpoints** (build the few YouTube needs now; rest follow the
  pattern later):
  - `POST /api/items` — ingest `{type, url}`
  - `GET /api/items` — list
  - `GET /api/items/:id` — item + transcript + insights + entities
  - `GET /api/entities/:slug`
- Auth is out of scope this milestone; the endpoint boundary is where it slots in.

## Data Model

Rename/restructure `episodes` → **`items`** (clean rewrite; existing rows dropped):

```
items
  id             uuid PK
  type           enum('podcast','youtube','article')
  title          text
  sourceUrl      text          -- canonical URL (podcast page / youtube watch URL)
  thumbnailUrl   text          -- was artworkUrl
  durationSec    int
  publishedAt    timestamp
  status         enum('processing','transcribing','analyzing','ready','failed')
  errorMessage   text
  sourceMetadata jsonb         -- youtube: {videoId, channelName, channelId}
                               -- podcast: {podcastName, guid, itunesCollectionId, itunesTrackId}
  createdAt      timestamp
```

Downstream tables (`transcripts`, `insights`, `chunks`, entity junction) have
their `episodeId` FK renamed to **`itemId`**; their structure is unchanged.
`segments` on `transcripts` is nullable (for future text-only sources).

## Pipeline / Data Flow (YouTube)

**Constraint:** Vercel is also a datacenter, so it cannot reach YouTube
directly — *all* YouTube access funnels through one WARP-gated Modal job.

1. **Ingest (Vercel, instant).** YouTube adapter validates URL, extracts
   `videoId`, creates the `item` row with `status: 'processing'` + placeholder
   title, triggers the Modal job with `{itemId, videoUrl, callbackUrl, secret}`.
   User gets instant feedback; card shows a processing state.
2. **Modal job `transcribe_youtube`** (sibling of `transcribe.py`, sharing image
   / volume / callback / secret-auth patterns):
   - **WARP egress:** image adds `wgcf` + `wireproxy`; WARP identity registered
     once and cached in the existing Modal Volume; `wireproxy` runs userspace
     SOCKS5 on `127.0.0.1`.
   - **Health gate:** hit `cloudflare.com/cdn-cgi/trace` through the proxy,
     confirm `warp=on`; else fail fast with a retryable error.
   - **Extract:** `yt-dlp --proxy socks5://…` pulls metadata (title, channel,
     channelId, thumbnail, duration, upload date) + bestaudio. Only yt-dlp
     traffic uses the proxy; Whisper model download goes direct.
   - **Transcribe:** `large-v3` on A10G, reusing cached weights volume.
3. **Callback (→ Vercel).** POSTs `{itemId, secret, metadata{…}, fullText,
   segments}`. Handler backfills real metadata on the `item`, stores the
   transcript, spawns the shared `process-content` pipeline
   (insights → chunk/embed → entities → `ready`).

**Maintenance footprint:** a pinned `yt-dlp` version (occasional bump) and the
cached WARP registration. No servers, proxies, or keys.

## Frontend

- **Ingest UI:** single "add content" input; source detected from the URL
  (YouTube → `youtube` adapter; podcast → existing path).
- **Routing:** generalize detail route to `/items/[id]`, rendering by `type`.
  `EpisodeView` → `ItemView` with a **pluggable player slot** (podcast → audio;
  youtube → YouTube IFrame).
- **Player abstraction:** generalize `usePlayer()` to wrap either the `<audio>`
  element or the YouTube IFrame Player behind one *seek* / *currentTime*
  interface. Existing chapter/quote/timestamp seeks then work for video unchanged.
- **Layout A:** YouTube IFrame pinned on top; **Live Transcript** | **Insights**
  tabs below, reusing current insights/entities/chapters/quotes rendering.
- **Live-reading transcript** (new component):
  - Loads the YouTube IFrame Player API; instantiates from `videoId`.
  - Polls `getCurrentTime()` ~4×/sec; binary-searches `segments` for the active
    one; highlights + auto-scrolls into view, with a "user scrolled away" guard
    (auto-scroll pauses; a "jump to current" affordance appears).
  - Click a line → `player.seekTo(start)`.
- **Mini-player on scroll:** `IntersectionObserver` on the video container; when
  it leaves the viewport the player docks fixed at **bottom-right** (keeps
  playing, transcript stays synced); restores full-width when scrolled back up;
  tapping it scrolls back to top.

## Error Handling

- **WARP unavailable** → fail fast (health gate), clear *retryable* message.
- **yt-dlp failures** → distinct, honest messages: private / members-only /
  age-restricted / geo-blocked / removed / live-not-ended. User-actionable, not
  blindly retryable.
- **Long video / Modal timeout** (30 min wall-clock cap) → clean timeout failure,
  documented upper bound, no hang.
- **Retry** reuses existing logic, generalized to `/api/items/[id]/retry`: if a
  transcript exists, resume from analysis (idempotent); else re-run ingestion.
- **Callback secret** validation unchanged (timing-safe compare).

## Testing

- **Unit:** YouTube adapter `detect`/`resolve` (URL → `videoId` across
  `watch` / `youtu.be` / `shorts`); DTO mappers (stable JSON shape); live
  transcript **active-segment selection** (pure binary-search function).
- **Pipeline:** feed a fixture `{fullText, segments}` through `process-content`
  to prove a `youtube` item flows end-to-end without touching Modal.
- **Modal/WARP:** not unit-tested; verified by an integration check against one
  short public video plus the runtime health gate. Explicitly manual.
- **Frontend:** active-segment logic unit-tested; mini-player observer +
  auto-scroll verified manually in-browser.

## Open Questions / Risks

- WARP longevity (see Egress caveats). Mitigated by health gate + pinned yt-dlp +
  clean retryable failures.
- `large-v3` on very long videos vs. the 30-min Modal timeout — confirm a sane
  duration cap during implementation.
- Confirm `wireproxy` runs cleanly within Modal's container sandbox (expected to,
  being userspace; verify empirically early).
