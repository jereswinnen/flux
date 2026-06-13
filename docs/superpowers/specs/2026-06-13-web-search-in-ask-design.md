# Web Search in /ask — Design

**Date:** 2026-06-13
**Status:** Approved design, ready for implementation planning

## Summary

Give the `/ask` answer model OpenAI's **built-in web-search tool** so it can fetch
relevant, current information from the web *in addition to* the user's library
(transcript/article chunks + highlights) — calling it agentically only when the
library doesn't cover the question. The Ask page shows a **live "Searching the web
for '<query>'" status** in the loading indicator while the search runs, and both
ask surfaces show the **gathered web pages as distinct "Web" source cards**.

## Decisions (from brainstorming)

- **Trigger:** *model decides per question* — the model is given a web-search tool
  and calls it only when the assembled library context is thin. Library + highlights
  remain the primary source.
- **Provider:** *OpenAI built-in web search* (`openai.tools.webSearch()`) — a
  provider-executed tool (OpenAI runs the search server-side). No new third-party
  dependency or key beyond OpenAI, already used for the LLM + embeddings.
- **Surfaces:** both the conversational **Ask** (`/api/chat`) and the search-page
  one-shot answer (`/api/answer`).
- **Live status (Ask):** the loading indicator shows when a web search is running
  and the query, like a typical chat assistant.
- **Web sources:** read-only context — cited and shown as "Web" cards, **not**
  ingested/embedded into the library.

## Architecture

Library retrieval is unchanged (chunks + highlights via `assembleAskSources`); its
context is injected as before. The answer call additionally gets the web-search tool
and a step budget so the model can *search → answer* in one turn. Web pages the model
used come back as citations, surfaced as `ChatSource` entries flagged `isWeb` (reusing
the existing source plumbing — jsonb storage, no migration). The Ask route switches
from a raw text stream to the AI SDK's structured event stream so the client can
render the live tool status and the web sources as they arrive.

Validated against the AI SDK tools docs (https://ai-sdk.dev/docs/foundations/tools):
provider-executed tool via `tools: { web_search: openai.tools.webSearch() }`,
multi-step via `stopWhen: stepCountIs(N)`, structured UI-message-stream parts for
tool calls/inputs and sources.

## Components

### 1. Tool wiring (both routes)
- Add `tools: { web_search: openai.tools.webSearch() }` and `stopWhen: stepCountIs(3)`
  to the `streamText` (chat) and `generateText` (answer) calls. The tool is
  provider-executed — no local `execute`.
- *Plan-level check:* confirm the configured model exposes the built-in web-search
  tool via the provider (use the provider's Responses API variant if required). If
  the model can't search, it simply answers from the library — no error, graceful
  degradation.

### 2. Prompt change — library-first, web fills gaps
Relax the current closed-book instruction to, in effect: *"Answer primarily from the
provided library excerpts and the user's highlights. If they don't fully cover the
question, or it needs current/external information, use web_search and integrate the
findings. Prefer the library; use the web to supplement, not replace. Keep citing
library sources with [n] / [timestamp] as before."* Applied to both routes' system
prompts.

### 3. Web sources → `ChatSource`
- Extend `ChatSource` (`lib/db/schema.ts`) and the client `ChatSourceRef`
  (`chat-message.tsx`) + search `Source` (`search-view.tsx`) with `isWeb?: boolean`
  and `url?: string | null`. `ChatSource` is jsonb → **no migration**.
- A web citation maps to `{ isWeb: true, url, itemTitle: <page title>, snippet:
  <text/snippet if any>, itemId: "", startSec: 0 }`. A small mapper turns the AI
  SDK's `source` parts/`sources` into these entries (dedupe by URL).

### 4. Structured streaming + live status (Ask page)
- The Ask route returns the AI SDK **structured event stream**
  (`toUIMessageStreamResponse`-style) instead of a raw text stream. Library sources
  may stay in the `x-sources` header (known upfront) or move into the stream; web
  sources arrive as `source` parts.
- `components/use-conversation.ts` stream reader handles part kinds:
  - **text** → append to the assistant message content (as today).
  - **web_search tool input/call** → set a transient `status` on the assistant
    message: `Searching the web for "<query>"…` (the query comes from the tool input
    arguments).
  - **source** (web) → append a web `ChatSource` to the message's `sources`.
- `UIMessage` gains a transient, non-persisted `status?: string | null`.
- `components/chat-message.tsx` loading indicator: while `status` is set (and no text
  yet), show a small spinner + the status line instead of the typing dots; clears
  once text streams in.
- The persisted message keeps only `content` + `sources` (incl. web). On reload you
  see the answer + Web cards, not the old "searching" line.

### 5. Web source cards (both UIs)
- `chat-message.tsx` and `search-view.tsx` render web sources as distinct cards/rows
  with a **"Web" badge**, the page title + domain, opening the `url` in a new tab
  (`target="_blank" rel="noopener noreferrer"`). They sit in the Sources section
  alongside the (grouped) episode cards and the Highlight cards — three clearly
  distinguished kinds.
- The search-page answer (`/api/answer`, non-streaming) shows the Web cards when the
  answer returns; it keeps its existing spinner (no live per-query status — that's
  inherently a streaming feature).

## Data flow

```
ask → assemble library context (chunks + highlights, unchanged)
    → model answers; may call web_search (agentic) when the library is thin
        ↳ Ask page streams: text · tool-input(query) → live status · source parts → Web cards
    → sources rendered: episode cards · Highlight cards · Web cards (external links)
```

## Error handling

- Web-search failure / model can't search → the model answers from the library;
  nothing surfaced to the user.
- Web source with no/blocked URL → dropped.
- Latency only when the model actually searches; library-answerable questions are
  unaffected. The `stopWhen` step budget bounds tool loops.
- Stream parsing is defensive: unknown part kinds ignored; an abort keeps the
  streamed-so-far content (existing behavior).

## Testing

- **Unit:** web-source mapper (AI SDK source → `ChatSource{ isWeb, url, itemTitle }`,
  URL dedupe); the source split in both UIs (library vs highlight vs web).
- **Integration (route):** with the model layer mocked to emit a `web_search`
  tool-call + a source, assert the route surfaces a web `ChatSource`. (The existing
  route tests already mock the model/db layer.)
- **Build + manual:** ask something the library covers → no web call, no Web cards;
  ask something current/external → the Ask loading indicator shows *Searching the web
  for "…"*, then the answer streams and Web cards appear and link out; the search page
  shows Web cards on the same kind of query.

## Scope

**In scope (v1):** web-search tool + step budget on both routes; library-first
prompt; `isWeb`/`url` on the source types + web-source mapper; structured event
streaming on the Ask route with live `web_search` status (+ query) in the loading
indicator; Web source cards in both UIs; capturing/persisting web citations.

**Deferred:** ingesting/embedding web pages into the library (read-only here); a
manual "search web" toggle (the model decides); per-domain allow/deny lists; live
status on the non-streaming search-page answer.

## Modularity note

The web-search tool and the library context are independent: retrieval
(`assembleAskSources`) is untouched, and web results plug in through the same
`ChatSource` shape via one `isWeb` flag — the only new seam. Swapping providers later
means changing the one `tools` line; the streaming/UI layers are provider-agnostic.
