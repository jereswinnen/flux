# Chat UX Upgrade — Design Spec

**Date:** 2026-06-07
**Status:** Approved for implementation

Make the multi-conversation chat (episode + library) feel like a great modern chat app: a real composer with streaming/scroll behavior, full conversation management (rename/delete/edit-and-resend), and polished markdown answers. Builds on the existing conversation system (`conversations`/`messages`, `/api/chat`, `useConversation`, `ConversationView`, `ConversationSwitcher`, `ChatMessage`, two-pane `AskLibrary`).

Out of scope this round: suggested prompts.

---

## Decisions locked in

| Area | Decision |
|---|---|
| Composer | Auto-growing `Textarea`; Enter sends, Shift+Enter newline; pinned bottom |
| Scroll | Stick-to-bottom while streaming only when near bottom; "jump to latest" button otherwise |
| Thinking | Animated "thinking…" in the assistant bubble before the first token |
| Conversation mgmt | Rename + delete in both places via a shared `ConversationList`; episode switcher becomes a **Popover** |
| Edit/regenerate | Server-correct: `regenerate` (no duplicate user turn) and `editFromMessageId` (truncate + re-ask), scoped to the **last user message** for edit |
| Markdown | `@tailwindcss/typography` `prose` styling tuned to theme |
| Tests | Run against the separate `podcast_kb_test` DB (never production) |

---

## 1. Composer + streaming feel

In `components/conversation-view.tsx`:
- Replace the `<Input>` with shadcn `<Textarea>` that auto-grows on input (`height = auto` → `scrollHeight`, capped ~200px, then internal scroll). Enter (no shift, not composing) submits; Shift+Enter inserts a newline. Disabled while `busy` or `disabled`.
- **Stick-to-bottom:** a small hook `components/use-stick-to-bottom.ts` returns `{ ref, atBottom, scrollToBottom }`. The scrollable message list uses `ref`; on `messages` change, if `atBottom` (within ~80px), scroll to bottom. An `onScroll` updates `atBottom`. When `!atBottom`, render a floating **"↓ jump to latest"** button (bottom-right of the list) that calls `scrollToBottom()`.
- **Thinking indicator:** when `busy` and the last message is an empty assistant message, render an animated three-dot "thinking…" in place of empty content (in `ChatMessage` or the view).

## 2. Conversation management

### Data + API
- Repo (`lib/db/conversations.ts`):
  - `rename(id, title)` — update title + `updatedAt`.
  - `truncateFrom(conversationId, messageId)` — look up the target message's `created_at`, then delete every message in that conversation with `created_at >= target.created_at` (i.e. the target and everything after it). Used by regenerate/edit.
- `PATCH /api/conversations/:id { title }` → rename (400 if title missing/blank).
- `DELETE /api/conversations/:id` — already exists.

### Chat route modes (`app/api/chat/route.ts`)
The route accepts one of three intents (all keyed by `conversationId`):
1. **send** `{ conversationId, content }` (today's behavior): add user msg → retrieve → stream → persist assistant.
2. **regenerate** `{ conversationId, regenerate: true }`: load messages; require a trailing assistant after a last user msg; `truncateFrom(lastAssistant.id)`; re-run retrieval from the last user message's content; stream; persist assistant. No new user turn.
3. **edit** `{ conversationId, editFromMessageId, content }`: `truncateFrom(editFromMessageId)`; then proceed exactly like **send** with `content` (add user msg, retrieve, stream). (Client only enables this for the last user message.)

This replaces the client-side regenerate that previously re-sent the question (which duplicated the user turn) — fixing the earlier-flagged data-hygiene issue.

### UI
- **`components/conversation-list.tsx`** (new, presentational): props `{ items: {id,title}[], activeId, onSelect, onRename(id,title), onDelete(id), onNew }`. Renders a "＋ New chat" action and a list; each row: title (click → select), a pencil that switches the row to an inline rename input (Enter/blur commits, Esc cancels), and a trash (delete). Active row highlighted.
- **Ask page** (`ask-library.tsx`): left pane uses `ConversationList` (adds rename to existing new/select/delete).
- **Episode switcher** (`conversation-switcher.tsx`): becomes a shadcn **Popover** — trigger shows the active thread title (or "New chat"), content is the `ConversationList`. Selecting/new closes the popover; rename/delete keep it open.
- **Edit-and-resend:** the last user message in `ConversationView` shows an "edit" affordance; clicking loads its text into the composer in "editing" mode; submitting calls the edit flow (`editFromMessageId` = that message id) instead of a normal send. A cancel returns to normal compose.

## 3. Polished markdown
- Add dev dep `@tailwindcss/typography`; enable in Tailwind v4 via `@plugin "@tailwindcss/typography";` in `app/globals.css` (after the `@import "tailwindcss"`).
- In `ChatMessage`, assistant content wrapper uses `prose prose-sm dark:prose-invert max-w-none` with a few theme-tuned overrides (links use `text-primary`; tighten margins). Keep the `a` renderer (timestamp seek vs. real links) and source chips.

## 4. Client state (`use-conversation.ts`)
Extend the hook:
- `send(content)` — unchanged.
- `regenerate()` — POST `{ conversationId, regenerate: true }`; optimistic: drop the trailing assistant, append a fresh empty assistant, stream into it. (Server truncates + re-answers, so reload stays consistent.)
- `editAndResend(messageId, content)` — POST `{ conversationId, editFromMessageId, content }`; optimistic: truncate client messages from `messageId`, append user+assistant, stream.
- Keep `stop` (AbortController). All three share the same streaming/`x-sources` reader.

## 5. New / changed files

- `lib/db/conversations.ts` (+`rename`, `truncateFrom`)
- `app/api/conversations/[id]/route.ts` (+`PATCH`)
- `app/api/chat/route.ts` (send/regenerate/edit modes)
- `components/use-conversation.ts` (regenerate/editAndResend)
- `components/use-stick-to-bottom.ts` (new)
- `components/conversation-list.tsx` (new, shared)
- `components/conversation-view.tsx` (textarea, scroll, thinking, edit affordance)
- `components/conversation-switcher.tsx` (Popover + ConversationList)
- `components/chat-message.tsx` (prose styling, edit affordance hook, thinking dots)
- `components/ask-library.tsx` (use ConversationList)
- `app/globals.css` + `package.json` (typography plugin); add shadcn `popover`

## 6. Testing
- Vitest (against `podcast_kb_test`): `rename` + `truncateFrom` (DB; truncation removes the message and all later ones, keeps earlier); chat route `regenerate` (no duplicate user turn; one fewer→same assistant) and `edit` (truncates then re-asks) — DB with the live model or a guard; `ConversationList` rename/delete callback behavior (pure/RTL-free assertions on handlers if feasible, else covered by typecheck).
- UI: `pnpm typecheck` + `pnpm build` + manual smoke (multiline send, Shift+Enter, auto-scroll + jump-to-latest, thinking dots, rename/delete in both surfaces, episode popover, edit-and-resend, regenerate without duplicate, markdown formatting).

## 7. Build order (one plan)
1. Repo (`rename`, `truncateFrom`) + `PATCH` route + tests.
2. Chat route modes (regenerate/edit) + tests.
3. `use-conversation` (regenerate/editAndResend) + `use-stick-to-bottom`.
4. `ConversationList` + Ask page adoption.
5. `ConversationSwitcher` popover.
6. `ConversationView` composer (textarea/scroll/thinking/edit) + `ChatMessage` edit affordance.
7. Markdown typography + styling.
8. Full verification + push (Railway auto-deploys; migration step is a no-op — no schema change this round).

## 8. Notes
- No DB schema/migration change this round (only new repo methods on existing tables).
- Theme tokens only; markdown prose tuned via `prose-invert` + utility overrides, no hardcoded colors.
