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
