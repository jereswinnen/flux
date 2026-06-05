# Setup

## Prerequisites
- Node + pnpm, a Railway account (Postgres), a Modal account, an OpenAI API key.

## 1. Local development
1. `pnpm install`
2. Copy `.env.example` → `.env.local`. Set `DATABASE_URL` to your Railway Postgres **public** connection string (the `…proxy.rlwy.net:PORT` one — the internal `postgres.railway.internal` host only resolves inside Railway). Set `TEST_DATABASE_URL` to the same value (tests run against the same database).
3. `pnpm db:migrate` (creates the pgvector extension, tables, and HNSW index)
4. `pnpm test` (should pass; the chat streaming test is skipped unless `OPENAI_API_KEY` is set)
5. `pnpm dev`

> Note: the DB-backed tests are destructive (they reset the `episodes` table). Don't run them against a database holding data you care about.

## 2. Deploy the Modal transcription function
Only the Modal *client* runs locally (the transcription itself runs in Modal's cloud), so your local Python version doesn't matter. Install the CLI in an isolated environment — on macOS, avoid `pip install` against the system Python (it's externally-managed). Use one of:
- **uv** (recommended): `brew install uv && uv tool install modal`
- **pipx**: `brew install pipx && pipx install modal`

Then:
1. `modal token new` (opens a browser to authenticate)
2. `modal deploy modal/transcribe.py`
3. Put the printed web endpoint URL in `MODAL_TRANSCRIBE_URL`.
4. Set `MODAL_WEBHOOK_SECRET` to a random string, e.g. `openssl rand -hex 32`. Use the **same** value in the app env and in Modal's call — the callback fails closed (rejects all requests) if it is unset.

## 3. Deploy the app on Railway
1. In your Railway project (with the Postgres service), add a service from this GitHub repo.
2. Set the app service's env vars:
   - `DATABASE_URL` → reference the Postgres service's **internal** URL, e.g. `${{Postgres.DATABASE_URL}}` (private network; faster, no egress).
   - `OPENAI_API_KEY`
   - `MODAL_TRANSCRIBE_URL`
   - `MODAL_WEBHOOK_SECRET`
   - `APP_URL` → the app's public Railway URL (used to build the Modal callback URL).
3. Build command `pnpm build`, start command `pnpm start`.
4. Apply migrations against the Railway DB (from your machine, using the public URL): `DATABASE_URL="<public-url>" pnpm db:migrate`.

## Environment variables
See `.env.example` for the full list:
`DATABASE_URL`, `TEST_DATABASE_URL`, `OPENAI_API_KEY`, `MODAL_TRANSCRIBE_URL`, `MODAL_WEBHOOK_SECRET`, `APP_URL`.
