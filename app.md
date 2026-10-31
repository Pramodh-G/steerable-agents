# Handoff: building the dashboard app

Read `dashboard.md` first (the spec). This file covers state, decisions, and how to pick up.

## State (2026-10-30, after build)

- **Built:** `dashboard/` (Next 16.4, Cache Components on: every page reads auth inside `<Suspense>`), `hooks/sync.py` (Stop + SessionEnd in `hooks/hooks.json`), `scripts/seed.py`, override corrections fed to Haiku in `hooks/pre_ask.py`, `.gitignore`.
- **Verified locally** against a PGlite-backed Neon-HTTP shim (`NEON_FETCH_ENDPOINT`, local testing only): `next build` passes; ingest/seed/re-sync are idempotent; bad token fails silent; login/cookie, Accept/Override, `/haiku` stats, and pulling reviews back into the store all work on real transcripts.
- **Deployed (2026-10-30):** https://steerable-agents-dashboard.vercel.app (Vercel project `steerable-agents-dashboard`, connected to GitHub: every push to `master` deploys, root directory `dashboard`). Neon free DB `steerable-agents-db` sets `DATABASE_URL`; `DASHBOARD_TOKEN` is set for production + preview. **The site is public** (user's call, for judges): pages and Accept/Override (`POST /api/review`) need no login; only the hook routes (`/api/ingest`, `/api/reviews`) need the bearer token. Public overrides sync into the local store and steer Haiku. The token lives only in `~/.claude/steerable-agents/sync.json` (mode 600), which turns sync on for every session running the plugin.
- **Not done:** seeding (user wants to seed later from a real repo with real agents), visual pass in a real browser, nothing committed.
- **Seeding note:** the local store `answers.jsonl` doesn't exist yet, so `seed.py` with no args has nothing to send. Use `--with-asks` (transcripts that used AskUserQuestion) or pass transcript paths. User decisions are read from the transcript's `toolUseResult` when no store record exists.

## Decisions the user made

- **Haiku answers stay hidden in the CLI** (`hooks/pre_ask.py` answers through the tool's `updatedInput`, so the terminal shows no dialog and no error for them). The user must *not* have to confirm Haiku's picks in the terminal; that defeats offloading decisions. The **dashboard is the only place to override** Haiku. Every accept/override is the right/wrong label for Haiku: the data flywheel.
- **Storage:** Neon Postgres (Vercel Marketplace).
- **Sync payload:** the full raw transcript JSONL, plus the session's store records.
- **Auth:** one shared token (`DASHBOARD_TOKEN`). Hooks send a bearer token, and the browser logs in once and gets an httpOnly cookie. No public pages.
- **Hosting:** Vercel (founders.inc wants a non-localhost demo). Build the dashboard before anything else from `vision.md`.
- **Timeline UX:** a session reads as *thinking → question → thinking → diff → question → discovery*. Decisions are the top-level cards, and the work between them is collapsed into one expandable line.
- **No post-session Haiku extraction.** Haiku only runs when questions are asked (PreToolUse). Drop the "Claude decided without asking" extraction for now.

## How the demo works (user asked)

The judges only use the deployed dashboard, never Claude Code.
1. **Live:** terminal with Claude Code on one side, dashboard on the other. A PostToolUse hook (`sync.py --live`, detached so it doesn't slow tool calls) syncs after every tool call and Stop after every turn, and the session page auto-refreshes (poll every ~3s with `router.refresh()`), so the timeline grows live. Override a Haiku answer in the browser and the `/haiku` accuracy page changes.
2. **Self-serve:** the deployed URL is pre-seeded with real past sessions (`scripts/seed.py`) for judges to click through.
3. **Backup:** a screen recording of part 1.

## Build plan

1. **`dashboard/`**: Next.js (App Router, TS), `@neondatabase/serverless`, plain CSS (no Tailwind). Vercel root directory = `dashboard`.
   - `lib/db.ts`: `neon(process.env.DATABASE_URL)`; `ensureSchema()` runs `CREATE TABLE IF NOT EXISTS` lazily (tables in `dashboard.md`).
   - `lib/auth.ts`: bearer check for hooks; (cookie login was removed; the site is public). Check auth in each page/route instead of in `proxy.ts`/middleware, to avoid Next-version quirks.
   - `lib/timeline.ts`: transcript lines + records → timeline items (see parsing notes).
   - API: `POST /api/ingest`, `GET /api/reviews?since=`, `POST /api/review`, `POST /api/login`.
   - Pages: `/` sessions, `/s/[id]` timeline with Accept/Override (client component) and auto-refresh, `/haiku` flywheel, `/login`.
   - Bulk upsert via `unnest(${nums}::int[], ${entries}::text[])` with `on conflict do nothing`. Strip `\u0000` before casting to jsonb.
2. **`hooks/sync.py`** (stdlib only, Stop + SessionEnd in `hooks/hooks.json`):
   - Opt-in: `STEERABLE_SYNC_URL` + `STEERABLE_SYNC_TOKEN`, or `~/.claude/steerable-agents/sync.json`. Otherwise a no-op.
   - Per-session line offset in `~/.claude/steerable-agents/sync_state.json`. Send new lines in ~2 MB chunks (Vercel's body cap is 4.5 MB), plus all of the session's records (the server upserts by `id`).
   - Pull `GET /api/reviews?since=` and append unseen `review` records to the local store.
   - Short timeouts, errors to stderr, print nothing to stdout (Stop hook stdout JSON can block).
   - Expose `sync_session(session_id, transcript_path, cwd)` for the seed script.
3. **`hooks/pre_ask.py`**: also feed `review` records with `verdict: override` to Haiku as precedents: the user's corrected answer, noting that Haiku got it wrong. This closes the flywheel loop.
4. **`scripts/seed.py`**: for each `session_id` in `answers.jsonl`, find `~/.claude/projects/*/<session_id>.jsonl` and call `sync_session`.
5. `.gitignore`: add `node_modules/`, `.next/`, `.vercel/`, `.env*.local`.
6. **Deploy:** the user needs to log in to Vercel (`npx vercel login`, or connect the GitHub repo), add Neon from the Marketplace (sets `DATABASE_URL`), and set `DASHBOARD_TOKEN`. Pushing and deploying are outward-facing, so confirm with the user first.

## Transcript parsing notes (checked on a real transcript)

Transcripts are at `~/.claude/projects/<cwd-with-dashes>/<session_id>.jsonl`. Many line types are noise for the timeline: `mode`, `permission-mode`, `attachment`, `api-request*`, `file-history-*`, `queue-operation`, `bridge-session`, `last-prompt`, `tools-used`, `system`. Use only:
- `ai-title` → `aiTitle`: a good session title.
- `user` with string `message.content` → the user's prompt (a top-level timeline item). Skip `isMeta` and `<command-…>`/`<local-command…>` wrappers.
- `user` with `tool_result` blocks (`tool_use_id`, `content`, `is_error`). Structured output is in the top-level `toolUseResult`. A Haiku auto-answer shows up as a normal `AskUserQuestion` result (or, with some questions left, a call whose result covers only those). The `auto_answer` record's `tool_use_id` + question say which answers were Haiku's. Older sessions show it as an `is_error` result carrying the deny reason.
- `assistant` blocks: `thinking` (**often empty text, only a signature**, so don't count on thinking content), `text`, and `tool_use` (`id`, `name`, `input`).
  - `AskUserQuestion` → decision cards. Match each `input.questions[].question` to an `answer` or `auto_answer` record by session + exact question text (first unused, by ts). Append any unmatched records at the end.
  - `Edit` (`old_string`/`new_string`), `MultiEdit` (`edits[]`), `Write` (`content`) → render as diffs.
  - Anything else → a one-line tool step, with the result truncated to ~2 KB.
- Group consecutive non-decision steps into one collapsed segment ("thought · edited 2 files · ran 4 commands").

## Environment gotchas

- System Node is v17 (too old). Node 22 is installed via nvm: run `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"` before `npm`/`npx`. Not on the default PATH.
- No Vercel CLI installed. `gh` is logged in as `Pramodh-G`; remote is `github.com/Pramodh-G/steerable-agents`.
- The Haiku API key lives at `~/.claude/steerable-agents/anthropic_api_key`. Never commit it.
- If you use a recent Next.js (16+): route `params` and `cookies()` are async, and middleware is renamed `proxy.ts`.
