# Web Search in /ask Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the `/ask` model use OpenAI's built-in web-search tool (agentically, library-first) and surface web results as distinct "Web" sources, with a live "Searching the web for '<query>'" status on the Ask page.

**Architecture:** Add `tools: { web_search: openai.tools.webSearch() }` + `stopWhen: stepCountIs(3)` to both ask routes. Library retrieval is unchanged; the model only searches when the library is thin. Web citations map to `ChatSource` entries flagged `isWeb` (jsonb, no migration). The Ask route switches to the AI SDK structured event stream so the client shows live tool status + web sources; the search page (non-streaming) shows web cards on completion.

**Tech Stack:** Next.js 16, AI SDK `ai`@6.0.197 + `@ai-sdk/openai`@3.0.68, React 19, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-13-web-search-in-ask-design.md`

**Verified APIs:** `openai.tools.webSearch()` exists; `stepCountIs`, `toUIMessageStreamResponse` exist. UI-message-stream part types: `text-delta` (`{type,id,delta}`), `tool-input-available` (`{type,toolCallId,toolName,input}`), `source-url` (`{type,sourceId,url}`), `source-document` (`{type,sourceId,title,mediaType}`), `finish`, `error` (`{errorText}`), `abort`.

## File Structure

- **Create:** `lib/ai/web-sources.ts` (+ `test/ai/web-sources.test.ts`).
- **Modify:** `lib/db/schema.ts` (`ChatSource` fields); `app/api/answer/route.ts` + `components/search-view.tsx` (non-streaming path + web cards); `app/api/chat/route.ts` (tool + structured stream + persist web sources); `components/use-conversation.ts` (parse structured stream + status); `components/chat-message.tsx` (`ChatSourceRef` fields + status indicator + web cards).

---

## Task 1: Web-source types + mapper

**Files:** Modify `lib/db/schema.ts`; Create `lib/ai/web-sources.ts`, `test/ai/web-sources.test.ts`.

- [ ] **Step 1: Extend `ChatSource`** in `lib/db/schema.ts`:

```ts
export type ChatSource = {
  itemId: string
  itemTitle: string
  startSec: number
  podcastName?: string | null
  artworkUrl?: string | null
  audioUrl?: string | null
  videoId?: string | null
  isHighlight?: boolean
  snippet?: string | null
  isWeb?: boolean
  url?: string | null
}
```

- [ ] **Step 2: Write `test/ai/web-sources.test.ts`**

```ts
import { describe, expect, it } from "vitest"
import { toWebSources } from "@/lib/ai/web-sources"

describe("toWebSources", () => {
  it("maps url sources to web ChatSources, titled, deduped by url", () => {
    const out = toWebSources([
      { sourceType: "url", id: "1", url: "https://example.com/a", title: "Article A" },
      { sourceType: "url", id: "2", url: "https://example.com/a", title: "Dup" },
      { sourceType: "url", id: "3", url: "https://news.org/x" },
    ])
    expect(out).toEqual([
      { isWeb: true, url: "https://example.com/a", itemTitle: "Article A", itemId: "", startSec: 0, snippet: null },
      { isWeb: true, url: "https://news.org/x", itemTitle: "news.org", itemId: "", startSec: 0, snippet: null },
    ])
  })
  it("ignores non-url / ur-less sources", () => {
    expect(toWebSources([{ sourceType: "document", id: "d" } as never, { sourceType: "url", id: "e" } as never])).toEqual([])
  })
})
```

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Create `lib/ai/web-sources.ts`**

```ts
import type { ChatSource } from "@/lib/db/schema"

/** A model "source" as emitted by the AI SDK for web-search results. */
export interface ModelSource {
  sourceType?: string
  id?: string
  url?: string
  title?: string
}

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

/** Map AI SDK web-search url sources to web `ChatSource` entries (deduped by url). */
export function toWebSources(sources: ModelSource[]): ChatSource[] {
  const seen = new Set<string>()
  const out: ChatSource[] = []
  for (const s of sources) {
    if (s.sourceType !== "url" || !s.url || seen.has(s.url)) continue
    seen.add(s.url)
    out.push({
      isWeb: true,
      url: s.url,
      itemTitle: s.title?.trim() || domain(s.url),
      itemId: "",
      startSec: 0,
      snippet: null,
    })
  }
  return out
}
```

- [ ] **Step 5: Run — expect PASS**; `npm run typecheck` clean. Commit:

```bash
git add lib/db/schema.ts lib/ai/web-sources.ts test/ai/web-sources.test.ts
git commit -m "feat(ask): web-source type + toWebSources mapper"
```

---

## Task 2: Search-page answer (non-streaming) web search + Web cards

**Files:** Modify `app/api/answer/route.ts`, `components/search-view.tsx`.

This proves the web-search tool end-to-end on the simpler non-streaming path before the streaming refactor.

- [ ] **Step 1: Verify the tool factory** — run: `node -e "const {openai}=require('@ai-sdk/openai'); console.log(typeof openai.tools.webSearch)"`. Expected: `function`. If it errors, inspect `node_modules/@ai-sdk/openai/dist/index.d.ts` for the exact path (fallback: `openai.tools.webSearchPreview`). Use whichever exists; note it.

- [ ] **Step 2: Wire `app/api/answer/route.ts`.** Add imports:

```ts
import { generateText, stepCountIs } from "ai"
import { openai } from "@ai-sdk/openai"
import { toWebSources } from "@/lib/ai/web-sources"
```

(Merge with existing `ai`/`@ai-sdk/openai` imports — add `stepCountIs`.)

Change the `generateText` call to add the tool + step budget, and relax the system prompt:

```ts
  const { text, sources: modelSources } = await generateText({
    model: openai("gpt-5.4-mini-2026-03-17"),
    tools: { web_search: openai.tools.webSearch() },
    stopWhen: stepCountIs(3),
    system:
      "You are a knowledge-base assistant answering questions from a personal library. " +
      "Answer primarily from the numbered sources below. If they don't fully cover the question, " +
      "or it needs current/external information, use the web_search tool and integrate what you find — " +
      "prefer the library, use the web to supplement. Be thorough and specific; cite library claims " +
      "with the matching [n]. If neither the sources nor the web answer it, say so plainly.",
    prompt: `Question: ${query}\n\nSources:\n${context}`,
  })
  const sourcesWithWeb = [...sources, ...toWebSources((modelSources ?? []) as never)]
```

Return `sources: sourcesWithWeb`:

```ts
  return Response.json({ answer: text, sources: sourcesWithWeb, entities })
```

(Keep the existing library `sources`/`context` assembly from `assembleAskSources`. `modelSources` is `result.sources` — the web pages the tool surfaced.)

- [ ] **Step 3: Render Web cards in `components/search-view.tsx`.** The `Source` type already has `isWeb?`/`url?` from Task 1's pattern — if not present, add them:

```ts
  isHighlight?: boolean
  snippet?: string | null
  isWeb?: boolean
  url?: string | null
```

Split web sources out (next to the highlight split from the earlier feature):

```ts
  const webSources = sources.filter((s) => s.isWeb)
  const highlightSources = sources.filter((s) => s.isHighlight)
  const groups = groupSources(sources.filter((s) => !s.isHighlight && !s.isWeb))
```

After the highlight rows in the Sources section, add web rows (external links):

```tsx
                {webSources.map((s, i) => (
                  <a
                    key={`web-${i}`}
                    href={s.url ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-2 rounded-lg border p-2.5 transition-colors hover:bg-muted"
                  >
                    <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-600 dark:text-sky-400">
                      Web
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm font-medium">{s.itemTitle}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {s.url ? new URL(s.url).hostname.replace(/^www\./, "") : ""}
                      </span>
                    </span>
                  </a>
                ))}
```

- [ ] **Step 4: Verify** — `npm run typecheck` clean; `npm run build` succeeds; `npm run lint` no new errors (baseline 11).

- [ ] **Step 5: Commit**

```bash
git add app/api/answer/route.ts components/search-view.tsx
git commit -m "feat(ask): web search on the search-page answer + Web source cards"
```

---

## Task 3: Ask route — web search tool + structured event stream

**Files:** Modify `app/api/chat/route.ts`.

- [ ] **Step 1: Add the tool + relax the prompt + switch the response to a UI message stream.** Add imports:

```ts
import { streamText, stepCountIs } from "ai"
import { toWebSources } from "@/lib/ai/web-sources"
```

(Merge `stepCountIs` into the existing `ai` import.)

Change the `streamText({...})` call: add `tools` + `stopWhen`, relax the system prompt's closed-book clause to allow web search (keep the `[n]` / `[timestamp]` citation guidance), and persist web sources in `onFinish`. The current `onFinish` stores the message with library `sources`; extend it:

```ts
  const result = streamText({
    model: openai("gpt-5.4-mini-2026-03-17"),
    tools: { web_search: openai.tools.webSearch() },
    stopWhen: stepCountIs(3),
    system:
      "You are answering questions about a personal podcast/article library using the provided excerpts. " +
      "Answer primarily from them. If they don't fully cover the question, or it needs current/external " +
      "information, use the web_search tool and integrate what you find — prefer the library, use the web " +
      "to supplement. Be thorough and specific. " +
      (libraryWide
        ? "The excerpts are numbered; cite the claims you rely on with the matching [n]. Do not write episode titles inline. "
        : "Cite the [timestamp] you rely on. ") +
      "If neither the excerpts nor the web answer it, say so.\n\nExcerpts:\n" +
      context,
    messages,
    onFinish: async ({ text, sources: modelSources }) => {
      const finalSources = [...sources, ...toWebSources((modelSources ?? []) as never)]
      if (conversationId) {
        await conversationRepo.addMessage({ conversationId, role: "assistant", content: text, sources: finalSources })
      }
    },
  })
```

(Match the existing `onFinish` body — it likely already calls `conversationRepo.addMessage`; only add the `toWebSources` merge. Keep any auto-title logic.)

Change the returned response from the text stream to the UI message stream, keeping the library sources in the `x-sources` header:

```ts
  return result.toUIMessageStreamResponse({
    headers: { "x-sources": encodeURIComponent(JSON.stringify(sources)) },
  })
```

(Replace the previous `toTextStreamResponse()` return. `sources` here is the library `ChatSource[]` computed before the call.)

- [ ] **Step 2: Verify** — `npm run typecheck` clean; `npm run build` succeeds; `npm run lint` no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat(ask): web search tool + structured event stream on the Ask route"
```

---

## Task 4: Client — parse the structured stream + live status

**Files:** Modify `components/use-conversation.ts`, `components/chat-message.tsx` (UIMessage type).

- [ ] **Step 1: Add a transient `status` to `UIMessage`** in `components/chat-message.tsx`:

```ts
export type UIMessage = {
  id?: string
  role: "user" | "assistant"
  content: string
  sources?: ChatSourceRef[] | null
  status?: string | null
}
```

- [ ] **Step 2: Rewrite the stream reader in `components/use-conversation.ts`.** The response is now an SSE UI message stream (`data: {json}` lines). Replace the raw-chunk loop with an SSE part parser. Read the `x-sources` header for library sources first (unchanged), then:

```ts
        const reader = res.body?.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        const webSources: NonNullable<UIMessage["sources"]> = []
        const titleById = new Map<string, string>()
        if (reader) {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() ?? ""
            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed.startsWith("data:")) continue
              const data = trimmed.slice(5).trim()
              if (!data || data === "[DONE]") continue
              let part: Record<string, unknown>
              try {
                part = JSON.parse(data)
              } catch {
                continue
              }
              applyPart(part)
            }
          }
        }

        function applyPart(part: Record<string, unknown>) {
          const type = part.type as string
          if (type === "text-delta" && typeof part.delta === "string") {
            const delta = part.delta
            setMessages((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              next[next.length - 1] = { ...last, content: last.content + delta, status: null, sources: mergedSources() }
              return next
            })
          } else if (type === "tool-input-available" && part.toolName === "web_search") {
            const input = part.input as { query?: string } | undefined
            const status = input?.query ? `Searching the web for “${input.query}”` : "Searching the web…"
            setMessages((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              next[next.length - 1] = { ...last, status }
              return next
            })
          } else if (type === "source-document" && typeof part.sourceId === "string" && typeof part.title === "string") {
            titleById.set(part.sourceId, part.title)
          } else if (type === "source-url" && typeof part.url === "string") {
            const url = part.url
            if (!webSources.some((w) => w.url === url)) {
              const title = (typeof part.sourceId === "string" && titleById.get(part.sourceId)) || hostname(url)
              webSources.push({ isWeb: true, url, itemTitle: title, itemId: "", startSec: 0, snippet: null })
              setMessages((prev) => {
                const next = [...prev]
                const last = next[next.length - 1]
                next[next.length - 1] = { ...last, sources: mergedSources() }
                return next
              })
            }
          }
        }

        function mergedSources(): UIMessage["sources"] {
          return [...(sources ?? []), ...webSources]
        }
```

Add a `hostname` helper near the top of the file:

```ts
function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}
```

(`sources` is the library array parsed from the `x-sources` header earlier in the function. The `setMessages` updates already exist in spirit — keep `syncAfterStream()`, abort handling, and `finally` as they are. The key change: parse SSE parts instead of appending raw text, set `status` on `tool-input-available`, accumulate `webSources` on `source-*` parts, and clear `status` once text streams.)

- [ ] **Step 3: Verify** — `npm run typecheck` clean; `npm run build` succeeds; `npm run lint` no new errors. (Behavioral correctness is verified manually in Task 6.)

- [ ] **Step 4: Commit**

```bash
git add components/use-conversation.ts components/chat-message.tsx
git commit -m "feat(ask): parse structured stream — live web-search status + web sources"
```

---

## Task 5: Ask UI — status indicator + Web cards

**Files:** Modify `components/chat-message.tsx`.

- [ ] **Step 1: Extend `ChatSourceRef`** (if not already) with `isWeb?: boolean` and `url?: string | null` (mirror `ChatSource`).

- [ ] **Step 2: Show the live status in the loading indicator.** Find the pending/typing-dots block (rendered when `pending` and no content). Replace it so a `status` shows a spinner + text:

```tsx
        ) : pending ? (
          message.status ? (
            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {message.status}
            </span>
          ) : (
            <span className="inline-flex gap-1">
              {/* ...existing three bouncing dots... */}
            </span>
          )
        ) : null}
```

Add `Loader2` to the `lucide-react` import. (Keep the existing dots markup for the no-status case.)

- [ ] **Step 3: Render Web source cards.** Where highlight sources are split out, also split web sources:

```ts
  const webSources = sources.filter((s) => s.isWeb)
  const highlightSources = sources.filter((s) => s.isHighlight)
  const shownSources = sources
    .map((s, i) => ({ s, n: i + 1 }))
    .filter(({ s }) => !s.isHighlight && !s.isWeb)
    .filter(({ n }) => citedNums.size === 0 || citedNums.has(n))
```

In the Sources section guard, include web: `{(shownSources.length > 0 || highlightSources.length > 0 || webSources.length > 0) && (`. After the highlight cards block, add web cards:

```tsx
              {webSources.length > 0 && (
                <div className="space-y-2">
                  {webSources.map((s, i) => (
                    <a
                      key={`web-${i}`}
                      href={s.url ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex w-full items-start gap-3 rounded-xl border p-2.5 text-left transition-colors hover:border-foreground/20 hover:bg-muted/50"
                    >
                      <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 font-sans text-[10px] font-medium uppercase tracking-wide text-sky-600 dark:text-sky-400">
                        Web
                      </span>
                      <span className="min-w-0 flex-1 font-sans">
                        <span className="line-clamp-1 text-sm font-medium">{s.itemTitle}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {s.url ? new URL(s.url).hostname.replace(/^www\./, "") : ""}
                        </span>
                      </span>
                    </a>
                  ))}
                </div>
              )}
```

(Web sources are not subject to `citedNums` — always shown when present, like highlight cards.)

- [ ] **Step 4: Verify** — `npm run typecheck` clean; `npm run build` succeeds; `npm run lint` no new errors.

- [ ] **Step 5: Commit**

```bash
git add components/chat-message.tsx
git commit -m "feat(ask): live web-search status indicator + Web source cards"
```

---

## Task 6: Final verification

- [ ] **Step 1:** `npm run typecheck` (clean); `npm test` (all pass — run ONCE; concurrent vitest runs corrupt the shared test DB); `npm run build` (succeeds); `npm run lint` (no new errors vs the pre-existing 11).
- [ ] **Step 2 (manual — also validates the two live-SDK unknowns):**
  - On `/ask`, ask something your library clearly covers → the model answers with no web call, no Web cards, normal typing indicator.
  - Ask something current/external (e.g. "what's the latest on X") → the loading indicator shows *Searching the web for "…"*, the answer streams, and **Web** cards appear linking out; reloading the conversation still shows the answer + Web cards.
  - On `/search`, run the same external query → the answer includes Web cards.
  - If the model rejects the `web_search` tool (provider/model mismatch), the request errors — report it; the fix is to use the provider's Responses-API model variant or `webSearchPreview`. (Do NOT mask it silently.)

---

## Self-Review (plan author)

- **Spec coverage:** tool + step budget both routes (Tasks 2–3); library-first prompt (Tasks 2–3); `isWeb`/`url` source fields + mapper (Task 1); structured streaming + live `web_search` status with query (Tasks 3–4); Web cards both UIs (Tasks 2, 5); persist web sources in `onFinish` (Task 3); read-only (no ingestion) ✅; non-streaming search page has no live status by design (Task 2) ✅.
- **Placeholder scan:** none — full code per step. The tool-factory verification (Task 2 Step 1) and the manual tool-support check (Task 6) are explicit verification steps with concrete fallbacks (`webSearchPreview`, Responses-API variant), not placeholders.
- **Type consistency:** `ChatSource`/`ChatSourceRef`/`Source` all gain `isWeb?`/`url?`; `toWebSources(ModelSource[]) → ChatSource[]` used by both routes; client web-source objects match the `ChatSource` web shape (`itemId:""`, `startSec:0`, `isWeb:true`, `url`, `itemTitle`); stream part types (`text-delta`/`tool-input-available`/`source-url`/`source-document`) match the verified protocol; `UIMessage.status` transient and only read by the indicator.
