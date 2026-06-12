# Modal transcription function

GPU transcription with `faster-whisper` (`large-v3`), deployed as a Modal web endpoint.

## Deploy
1. Install Modal: `pip install modal`
2. Authenticate: `modal token new`
3. Deploy: `modal deploy modal/transcribe.py`
4. Copy the printed web endpoint URL into the app's `MODAL_TRANSCRIBE_URL` env var.

## Contract
`POST` JSON `{ audio_url, episode_id, callback_url, secret }`.

Responds `{ "status": "accepted" }` (or `401` if `secret` is missing), spawns the
transcription on a GPU, then `POST`s the result to `callback_url`:

- success: `{ episode_id, secret, transcript, segments: [{ start, end, text }] }`
- failure: `{ episode_id, secret, error }`

The app's `/api/modal/callback` route validates `secret` against `MODAL_WEBHOOK_SECRET`,
so use the same value here and in the app.

## Verify after deploy
```
curl -X POST <web-url> \
  -H 'content-type: application/json' \
  -d '{"audio_url":"<short.mp3>","episode_id":"test","callback_url":"https://webhook.site/<id>","secret":"<secret>"}'
```
Expect `{"status":"accepted"}`, and the callback URL should receive a transcript shortly after.

---

# YouTube transcription function (`transcribe_youtube.py`)

Same GPU transcription, but the source is a YouTube URL. Audio + metadata are
pulled with `yt-dlp` over a **Cloudflare WARP** egress (so YouTube doesn't block
the datacenter IP), then transcribed with the same `large-v3` setup.

## One-time setup
1. Create the webhook secret as a Modal secret (the YouTube endpoint validates
   the caller against it — unlike the older podcast endpoint, it's not a no-op):
   ```
   modal secret create podcast-kb-webhook MODAL_WEBHOOK_SECRET=<same value as the app>
   ```

## Deploy
1. `modal deploy modal/transcribe_youtube.py`
2. Copy the printed web endpoint URL into the app's **`MODAL_TRANSCRIBE_YOUTUBE_URL`** env var.

No Cloudflare account is needed: WARP self-registers a free anonymous identity on
the first run and caches it in the `warp-cache` Modal volume. The whisper weights
are shared with the podcast function via the `whisper-cache` volume.

## Contract
`POST` JSON `{ video_url, item_id, callback_url, secret }`.

Responds `{ "status": "accepted" }` (or `401` if `secret` is invalid, `400` if a
field is missing), spawns the job, then `POST`s to `callback_url`:

- success: `{ item_id, secret, metadata: { title, channelName, thumbnailUrl, durationSec, publishedAt }, transcript, segments: [{ start, end, text }] }`
- failure: `{ item_id, secret, error }`

The app's `/api/modal/callback` reads `item_id`, backfills the item from
`metadata` (channelName→source name, thumbnailUrl→artwork), then runs the
analysis pipeline.

## Maintenance
- `yt-dlp` is installed unpinned, so rebuilding the image picks up the latest. If
  YouTube extraction starts failing, redeploy (rebuild) to refresh it; pin to a
  known-good version only if a release regresses.
- `wgcf`/`wireproxy` release URLs live at the top of `transcribe_youtube.py`. If
  the image build 404s, update them.

## Verify after deploy
```
curl -X POST <web-url> \
  -H 'content-type: application/json' \
  -d '{"video_url":"https://youtu.be/<id>","item_id":"test","callback_url":"https://webhook.site/<id>","secret":"<secret>"}'
```
Expect `{"status":"accepted"}`; the callback should receive metadata + transcript shortly after.

> Note: the podcast `transcribe.py` endpoint still uses a presence-only secret
> check. Hardening it to a real comparison (as done here) is a tracked fast-follow.
