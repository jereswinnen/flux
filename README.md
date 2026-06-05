# Podcast Knowledge Base

A personal app that finds a podcast episode (via iTunes search or a pasted URL/RSS feed), transcribes it on GPU with `faster-whisper`, generates structured insights, and makes the content queryable through semantic search and grounded Q&A.

**Stack:** Next.js 16 (App Router) + shadcn/ui, Drizzle ORM + Postgres/pgvector (Railway), Modal (`faster-whisper large-v3`) for transcription, OpenAI via the Vercel AI SDK for insights/embeddings/chat.

- Setup & deployment: see [SETUP.md](./SETUP.md)
- Design spec: [docs/superpowers/specs/2026-06-05-podcast-knowledge-base-design.md](./docs/superpowers/specs/2026-06-05-podcast-knowledge-base-design.md)
- Implementation plan: [docs/superpowers/plans/2026-06-05-podcast-knowledge-base.md](./docs/superpowers/plans/2026-06-05-podcast-knowledge-base.md)
