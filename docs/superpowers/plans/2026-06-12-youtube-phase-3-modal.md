# YouTube Phase 3 — Modal `transcribe_youtube` (WARP + yt-dlp) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** A Modal function that takes a YouTube URL, extracts audio + metadata via `yt-dlp` over a Cloudflare WARP egress (so YouTube doesn't block the datacenter IP), transcribes with the existing `large-v3` setup, and POSTs the transcript **and** backfill metadata to the app callback — matching the wire contract Phase 2 already speaks.

**Architecture:** New `modal/transcribe_youtube.py` (sibling of `transcribe.py`, reusing its CUDA image + `whisper-cache` volume patterns). WARP egress via `wgcf` (registers a free anonymous WARP identity, cached in a Volume) + `wireproxy` (userspace SOCKS5 — no TUN/NET_ADMIN). Pure, testable logic (metadata mapping, wireproxy-config building, date parsing) lives in `modal/youtube_helpers.py` with real unit tests. The Modal integration itself is verified by `modal deploy` + a real-video smoke test (manual; documented).

**Tech Stack:** Modal, faster-whisper large-v3 (CUDA), yt-dlp, wgcf, wireproxy, Python 3.11. Pure-helper tests run with plain `python3` (no new test infra).

---

## Wire Contract (must match Phase 2 — do not change)

- **In** (from `triggerYoutubeTranscription` in `lib/modal/client.ts`): `POST { item_id, video_url, callback_url, secret }`.
- **Out (success)** → `POST callback_url`: `{ item_id, secret, metadata: { title, channelName, thumbnailUrl, durationSec, publishedAt }, transcript, segments: [{start,end,text}] }`.
- **Out (error)** → `{ item_id, secret, error }`.
- The app callback (`app/api/modal/callback/route.ts`, built in Phase 2) reads `body.item_id`, maps `metadata.channelName→podcastName`, `metadata.thumbnailUrl→artworkUrl`, applies `title`/`durationSec`/`publishedAt`, then runs the pipeline. The `segments` shape `{start,end,text}` is exactly what `processContent`/`chunkSegments` expect.

## Scope & Boundaries

- **In scope:** `modal/youtube_helpers.py` (+ tests), `modal/transcribe_youtube.py`, `modal/README.md` update (deploy + env), a short note that `MODAL_TRANSCRIBE_YOUTUBE_URL` (already in `.env.example` from Phase 2) is set after deploy.
- **Manual (user, documented in Task 5):** `modal deploy modal/transcribe_youtube.py`; set `MODAL_TRANSCRIBE_YOUTUBE_URL` in the app env; smoke-test one real public video.
- **Out of scope:** the detail-page YouTube player + live transcript (Phase 4). After Phase 3, a YouTube add transcribes and analyzes end-to-end; it just renders with the existing (audio-less) detail UI until Phase 4.
- **Version risk:** the `wgcf` / `wireproxy` / `yt-dlp` release URLs+versions below are best-known values; they change over time. The implementer MUST confirm current release URLs at build time (the Modal image build will 404 on a stale URL). This is called out in Task 3.

## File Structure

- **Create:** `modal/youtube_helpers.py`, `modal/test_youtube_helpers.py`, `modal/transcribe_youtube.py`.
- **Modify:** `modal/README.md`.

---

## Task 1: Pure helpers — date parsing + metadata mapping (TDD, plain python)

**Files:** Create `modal/youtube_helpers.py`, `modal/test_youtube_helpers.py`.

These are stdlib-only (no `modal`/`yt-dlp` imports) so they run anywhere with `python3`.

- [ ] **Step 1: Write `modal/test_youtube_helpers.py`** (plain asserts; exits nonzero on failure)

```python
import sys
from youtube_helpers import iso_from_upload_date, map_ytdlp_metadata, build_wireproxy_config


def check(name, cond):
    if not cond:
        print(f"FAIL: {name}")
        sys.exit(1)
    print(f"ok: {name}")


# iso_from_upload_date
check("upload date -> iso", iso_from_upload_date("20260612") == "2026-06-12")
check("none upload date", iso_from_upload_date(None) is None)
check("bad upload date", iso_from_upload_date("2026") is None)

# map_ytdlp_metadata
info = {
    "title": "Real Title",
    "channel": "Some Channel",
    "uploader": "fallback uploader",
    "thumbnail": "https://i.ytimg.com/x.jpg",
    "duration": 1234.7,
    "upload_date": "20260101",
    "id": "dQw4w9WgXcQ",
}
m = map_ytdlp_metadata(info)
check("title", m["title"] == "Real Title")
check("channelName prefers channel", m["channelName"] == "Some Channel")
check("thumbnailUrl", m["thumbnailUrl"] == "https://i.ytimg.com/x.jpg")
check("durationSec int", m["durationSec"] == 1234)
check("publishedAt iso", m["publishedAt"] == "2026-01-01")

# uploader fallback when no channel
m2 = map_ytdlp_metadata({"title": "T", "uploader": "Up"})
check("channelName falls back to uploader", m2["channelName"] == "Up")
check("missing fields omitted", "thumbnailUrl" not in m2 and "durationSec" not in m2)

# build_wireproxy_config
cfg = build_wireproxy_config("[Interface]\nPrivateKey = abc\n", 25344)
check("config keeps interface", "[Interface]" in cfg and "PrivateKey = abc" in cfg)
check("config adds socks5", "[Socks5]" in cfg and "BindAddress = 127.0.0.1:25344" in cfg)

print("ALL PASS")
```

- [ ] **Step 2: Run — expect FAIL** (`cd modal && python3 test_youtube_helpers.py`) — module missing.

- [ ] **Step 3: Create `modal/youtube_helpers.py`**

```python
"""Pure helpers for the YouTube transcription Modal function.

Stdlib-only and free of any `modal`/`yt_dlp` imports so they can be unit-tested
without those packages installed.
"""
from typing import Optional


def iso_from_upload_date(d: Optional[str]) -> Optional[str]:
    """yt-dlp `upload_date` is 'YYYYMMDD'. Return 'YYYY-MM-DD', or None if absent/malformed."""
    if not d or len(d) != 8 or not d.isdigit():
        return None
    return f"{d[0:4]}-{d[4:6]}-{d[6:8]}"


def map_ytdlp_metadata(info: dict) -> dict:
    """Map a yt-dlp info dict to the callback `metadata` shape the app expects.
    Only includes keys that are present, so the callback's per-field guards apply."""
    meta: dict = {}
    if info.get("title"):
        meta["title"] = info["title"]
    channel = info.get("channel") or info.get("uploader")
    if channel:
        meta["channelName"] = channel
    if info.get("thumbnail"):
        meta["thumbnailUrl"] = info["thumbnail"]
    duration = info.get("duration")
    if isinstance(duration, (int, float)):
        meta["durationSec"] = int(duration)
    iso = iso_from_upload_date(info.get("upload_date"))
    if iso:
        meta["publishedAt"] = iso
    return meta


def build_wireproxy_config(wg_profile: str, socks_port: int) -> str:
    """wireproxy uses a standard WireGuard config plus a [Socks5] section.
    `wg_profile` is the output of `wgcf generate`."""
    return wg_profile.rstrip() + f"\n\n[Socks5]\nBindAddress = 127.0.0.1:{socks_port}\n"
```

- [ ] **Step 4: Run — expect `ALL PASS`.**

- [ ] **Step 5: Commit**

```bash
git add modal/youtube_helpers.py modal/test_youtube_helpers.py
git commit -m "feat(modal): pure youtube metadata/config helpers + tests"
```

---

## Task 2: The Modal function `modal/transcribe_youtube.py`

**Files:** Create `modal/transcribe_youtube.py`.

Follows `transcribe.py`'s structure (same CUDA image base, `whisper-cache` volume, spawn-from-web-endpoint, secret check, callback). Adds WARP egress + yt-dlp. WARP identity is cached in a second Volume so it registers once.

- [ ] **Step 1: Create `modal/transcribe_youtube.py`**

```python
import modal

app = modal.App("podcast-kb-transcribe-youtube")

CACHE_DIR = "/cache"  # shared whisper weights (same volume as transcribe.py)
model_cache = modal.Volume.from_name("whisper-cache", create_if_missing=True)

WARP_DIR = "/warp"  # persists the registered WARP identity across cold starts
warp_cache = modal.Volume.from_name("warp-cache", create_if_missing=True)

SOCKS_PORT = 25344

# NOTE (version risk): confirm these release URLs are current at build time — they
# change. A stale URL fails the image build with a 404.
WGCF_URL = "https://github.com/ViRb3/wgcf/releases/download/v2.2.27/wgcf_2.2.27_linux_amd64"
WIREPROXY_URL = "https://github.com/whyvl/wireproxy/releases/download/v1.0.9/wireproxy_linux_amd64.tar.gz"

image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04", add_python="3.11"
    )
    .apt_install("ffmpeg", "wget", "ca-certificates")
    .pip_install(
        "faster-whisper==1.0.3",
        "requests==2.32.3",
        "fastapi[standard]",
        "yt-dlp==2025.6.9",  # pin; bump when YouTube changes its player
    )
    .run_commands(
        f"wget -q -O /usr/local/bin/wgcf {WGCF_URL} && chmod +x /usr/local/bin/wgcf",
        f"wget -q -O /tmp/wp.tar.gz {WIREPROXY_URL} && tar -xzf /tmp/wp.tar.gz -C /usr/local/bin wireproxy && chmod +x /usr/local/bin/wireproxy",
    )
    # ship the pure helpers into the image
    .add_local_python_source("youtube_helpers")
)


def _start_warp():
    """Register (once, cached) a free WARP identity and start wireproxy as a
    userspace SOCKS5 proxy on 127.0.0.1:SOCKS_PORT. Returns when WARP is up."""
    import os
    import subprocess
    import time
    import requests
    from youtube_helpers import build_wireproxy_config

    os.makedirs(WARP_DIR, exist_ok=True)
    account = os.path.join(WARP_DIR, "wgcf-account.toml")
    profile = os.path.join(WARP_DIR, "wgcf-profile.conf")
    wp_conf = os.path.join(WARP_DIR, "wireproxy.conf")

    warp_cache.reload()
    if not os.path.exists(account):
        # register a fresh anonymous WARP identity (accepts TOS) + generate wg profile
        subprocess.run(
            ["wgcf", "register", "--accept-tos", "--config", account],
            check=True, cwd=WARP_DIR,
        )
    if not os.path.exists(profile):
        subprocess.run(
            ["wgcf", "generate", "--config", account, "--profile", profile],
            check=True, cwd=WARP_DIR,
        )
    with open(profile) as f:
        wg = f.read()
    with open(wp_conf, "w") as f:
        f.write(build_wireproxy_config(wg, SOCKS_PORT))
    warp_cache.commit()

    # start the userspace proxy (no TUN / NET_ADMIN needed)
    subprocess.Popen(["wireproxy", "-c", wp_conf])

    # health gate: confirm WARP is the egress before doing any YouTube work
    proxies = {"http": f"socks5://127.0.0.1:{SOCKS_PORT}", "https": f"socks5://127.0.0.1:{SOCKS_PORT}"}
    for _ in range(30):
        try:
            r = requests.get("https://www.cloudflare.com/cdn-cgi/trace", proxies=proxies, timeout=5)
            if "warp=on" in r.text or "warp=plus" in r.text:
                return proxies
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError("WARP egress did not come up")


@app.function(
    image=image,
    gpu="A10G",
    timeout=1800,
    volumes={CACHE_DIR: model_cache, WARP_DIR: warp_cache},
)
def transcribe_youtube(video_url: str, item_id: str, callback_url: str, secret: str):
    import os
    import tempfile
    import requests
    from faster_whisper import WhisperModel
    from yt_dlp import YoutubeDL
    from youtube_helpers import map_ytdlp_metadata

    try:
        proxies = _start_warp()
        socks = f"socks5://127.0.0.1:{SOCKS_PORT}"

        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "audio.%(ext)s")
            ydl_opts = {
                "format": "bestaudio/best",
                "outtmpl": out,
                "proxy": socks,
                "quiet": True,
                "noplaylist": True,
            }
            with YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(video_url, download=True)
                audio_path = ydl.prepare_filename(info)

            metadata = map_ytdlp_metadata(info)

            # transcribe (identical cache-aware load to transcribe.py)
            model_cache.reload()
            snapshot = os.path.isdir(
                os.path.join(CACHE_DIR, "models--Systran--faster-whisper-large-v3")
            )
            model = WhisperModel(
                "large-v3",
                device="cuda",
                compute_type="float16",
                download_root=CACHE_DIR,
                local_files_only=snapshot,
            )
            if not snapshot:
                model_cache.commit()
            segments_iter, _info = model.transcribe(audio_path, vad_filter=True)

            segments = []
            parts = []
            for s in segments_iter:
                segments.append({"start": s.start, "end": s.end, "text": s.text.strip()})
                parts.append(s.text.strip())

            payload = {
                "item_id": item_id,
                "secret": secret,
                "metadata": metadata,
                "transcript": " ".join(parts),
                "segments": segments,
            }
    except Exception as e:
        payload = {"item_id": item_id, "secret": secret, "error": str(e)}

    resp = requests.post(callback_url, json=payload, timeout=60)
    resp.raise_for_status()


@app.function(image=image)
@modal.fastapi_endpoint(method="POST")
def web(body: dict):
    from fastapi import Response

    if not body.get("secret"):
        return Response(content='{"error":"missing secret"}', status_code=401, media_type="application/json")

    transcribe_youtube.spawn(
        video_url=body["video_url"],
        item_id=body["item_id"],
        callback_url=body["callback_url"],
        secret=body["secret"],
    )
    return {"status": "accepted"}
```

- [ ] **Step 2: Syntax-check both modal files**

Run: `python3 -m py_compile modal/transcribe_youtube.py modal/youtube_helpers.py`
Expected: no output, exit 0. (We cannot import `transcribe_youtube.py` without `modal` installed; `py_compile` validates syntax. The pure helpers are already behavior-tested in Task 1.)

- [ ] **Step 3: Re-run the helper tests** (ensure the import-into-image didn't change behavior): `cd modal && python3 test_youtube_helpers.py` → `ALL PASS`.

- [ ] **Step 4: Commit**

```bash
git add modal/transcribe_youtube.py
git commit -m "feat(modal): transcribe_youtube — WARP egress + yt-dlp + large-v3"
```

---

## Task 3: Verify release URLs + finalize pins

**Files:** possibly edit `modal/transcribe_youtube.py` (the three version constants).

- [ ] **Step 1: Confirm current release URLs** for `wgcf`, `wireproxy`, and `yt-dlp`. For each, check the project's latest release and update `WGCF_URL`, `WIREPROXY_URL`, and the `yt-dlp==` pin if the values in Task 2 are stale. (The `wireproxy` repo moved orgs historically — confirm the correct owner and that the asset is named `wireproxy_linux_amd64.tar.gz` and contains a `wireproxy` binary.) Use WebSearch/WebFetch or `gh release list` if available. If you cannot verify, leave the Task 2 values and add a `# UNVERIFIED` comment next to each so the deployer checks.
- [ ] **Step 2: `python3 -m py_compile modal/transcribe_youtube.py`** still clean.
- [ ] **Step 3: Commit** any changes: `git add modal/transcribe_youtube.py && git commit -m "chore(modal): pin verified wgcf/wireproxy/yt-dlp versions"` (skip if no change).

---

## Task 4: Docs

**Files:** Modify `modal/README.md`.

- [ ] **Step 1:** Add a section documenting the YouTube function: deploy with `modal deploy modal/transcribe_youtube.py`; after deploy, copy the printed `web` endpoint URL into the app env as `MODAL_TRANSCRIBE_YOUTUBE_URL`; note that WARP self-registers on first run and is cached in the `warp-cache` volume (no Cloudflare account needed); note the shared `MODAL_WEBHOOK_SECRET` is reused. Mention the wire contract (`item_id`/`video_url` in; `item_id` + `metadata` + `transcript`/`segments` out).
- [ ] **Step 2: Commit:** `git add modal/README.md && git commit -m "docs(modal): YouTube transcription deploy + env"`

---

## Task 5: Verification + manual deploy handoff

- [ ] **Step 1 (automated):** `python3 modal/test_youtube_helpers.py` → `ALL PASS`; `python3 -m py_compile modal/transcribe_youtube.py modal/youtube_helpers.py` → clean. Confirm the app side is unaffected: `npm run typecheck` clean, `npm test` green (no TS changed in this phase, so this should pass untouched).
- [ ] **Step 2 (MANUAL — user, documented):** This is the real integration test and requires Modal credentials + network; it CANNOT be done in CI:
  1. `modal deploy modal/transcribe_youtube.py`
  2. Set `MODAL_TRANSCRIBE_YOUTUBE_URL` (app env) to the printed `web` URL.
  3. Paste a short public YouTube URL in the app's ⌘K palette → confirm the item reaches `ready` with the real title/thumbnail backfilled and a transcript.
  4. If the WARP image build fails on a 404, update the release URLs (Task 3) and redeploy. If YouTube still blocks, check `wgcf`/`wireproxy` logs in the Modal dashboard.

---

## Self-Review (plan author)

- **Spec coverage:** WARP egress (wgcf+wireproxy userspace, cached) ✅; yt-dlp audio+metadata ✅; large-v3 reuse ✅; health gate ✅; callback contract matches Phase 2 (`item_id`/`metadata`/`transcript`/`segments`) ✅; pure logic unit-tested ✅; deploy/env documented ✅.
- **Placeholder scan:** none — full code provided. The version URLs are explicitly flagged as needing verification (Task 3), not left as TODO.
- **Honest limits:** the Modal/WARP/yt-dlp integration is not CI-testable here; verification is py_compile + helper tests + contract review, with deploy + real-video smoke as a documented manual user step. This is inherent to Modal, not a gap in the plan.
- **Contract consistency:** metadata keys (`title`, `channelName`, `thumbnailUrl`, `durationSec`, `publishedAt`) exactly match the callback's mapping built in Phase 2; `segments` `{start,end,text}` matches `chunkSegments`.
