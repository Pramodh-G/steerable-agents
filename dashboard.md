# Dashboard

A hosted web app (Next.js on Vercel) where every agent session sends its transcript and decisions, and where a human reviews them in one place. It's hosted because the demo can't run on localhost.

## What it's for

1. **One place for every agent.** Each Claude Code session running the plugin syncs to the dashboard as it goes, so you can see all your agents' work without watching any terminal.
2. **A session timeline compressed around decisions.** A session reads as *model thinks → asks a question → thinks → produces a diff → asks again → finds something new*. Decisions are the top-level cards. The work between them (thinking, tool calls, diffs) is collapsed into a single line you can expand.
3. **The only place to override Haiku.** In the CLI, questions Haiku answers from precedent are never shown to the user; Claude just mentions them in one line and carries on. The user reviews those answers here: **Accept** or **Override** (pick another option, or write your own).
4. **The flywheel.** Every accept or override is a label on a Haiku decision: right or wrong. The dashboard tracks Haiku's accuracy over time and lists exactly where it went wrong. Overrides sync back to the local store, so the next precedent check learns from them.

## Not in scope (for now)

- Extracting decisions Claude made without asking.
- Linking each decision to the exact diff it caused (the timeline shows them in order instead).
- Multi-user accounts.

## How data gets there

```
Claude Code session
  ├─ pre_ask.py   (PreToolUse)  Haiku auto-answers → auto_answer record (local)
  ├─ post_ask.py  (PostToolUse) user answers      → answer record (local)
  └─ sync.py      (Stop + SessionEnd)
        POST /api/ingest  { session, new transcript lines since last sync, this session's records }
        GET  /api/reviews  → append dashboard accepts/overrides to the local store as `review` records
```

- **Opt-in.** `sync.py` does nothing unless `STEERABLE_SYNC_URL` and `STEERABLE_SYNC_TOKEN` are set (or `~/.claude/steerable-agents/sync.json` exists). Local first: nothing leaves the machine otherwise.
- **Full raw transcript.** The server gets the transcript JSONL as-is and parses it into the timeline. That includes tool outputs and file contents, so syncing means trusting the dashboard with them.
- **Incremental and idempotent.** `sync.py` remembers a per-session line offset in `~/.claude/steerable-agents/sync_state.json` and only sends new lines. The server upserts by `(session_id, line_no)` for transcript lines and by `id` for records, so a retry never duplicates anything.
- **Fail silent, fast.** Short timeout, errors go to stderr, never blocks the session.
- **Seed script.** `scripts/seed.py` uploads an existing `answers.jsonl` plus the matching transcripts from `~/.claude/projects/` so the demo has real history.

## Data model (Neon Postgres)

```sql
sessions          (id text pk, cwd text, first_seen timestamptz, last_seen timestamptz)
transcript_lines  (session_id text, line_no int, entry jsonb, primary key (session_id, line_no))
records           (id text pk, session_id text, kind text, source text, ts timestamptz, data jsonb)
```

`records.data` is the store record verbatim (`schema_version: 1`), so the hosted copy is still a dataset, not a cache. Dashboard reviews are written as a new record kind:

```json
{"kind": "review", "source": "user", "auto_answer_id": "<id>", "verdict": "accept" | "override",
 "answer": "<the user's answer if override>", "schema_version": 1, ...}
```

## Pages

- **`/` Sessions.** One row per session: project (cwd), last activity, and counts for *you decided*, *Haiku decided*, and *needs review* (Haiku answers not yet accepted or overridden).
- **`/s/[id]` Timeline.** The compressed decision timeline:
  - **You decided:** question, every option offered, your pick (and free text or notes).
  - **Haiku decided:** question, Haiku's answer, its reason, a link to the precedent it reused, and Accept / Override. Once reviewed, it shows the verdict.
  - **Between decisions:** a collapsed segment such as "thought · edited 2 files · ran 4 commands", which expands to thinking, text, tool calls, and diffs (Edit/Write rendered as diffs).
- **`/haiku` Flywheel.** Haiku's accuracy: accepted / overridden / unreviewed, accuracy over time, and the list of overrides (question, Haiku's answer, your answer, the precedent it leaned on). This is where Haiku is going wrong.

## API

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/ingest` | bearer token | Upsert session, transcript lines, records |
| `GET /api/reviews?since=<ts>` | bearer token | Reviews made on the dashboard, for the local store |
| `POST /api/review` | none (public) | Accept / override an auto-answer |

## Auth

One shared secret, `DASHBOARD_TOKEN`, used only by the hooks (`Authorization: Bearer` on `/api/ingest` and `/api/reviews`). The browser side is public so judges can use it: anyone with the URL can view every session and Accept/Override, and those reviews sync back into the local store.

## Repo layout

```
dashboard/          # Next.js app (App Router, TypeScript), deployed to Vercel with root dir = dashboard
hooks/sync.py       # Stop + SessionEnd sync hook
scripts/seed.py     # one-off upload of existing history
```

## Open questions

- **Overrides after the fact.** By the time you override on the dashboard, Claude has already acted on Haiku's answer. For now the override only fixes future sessions. Later, it could be pushed into a running session.
- **Transcript size.** Vercel request bodies cap at 4.5 MB, so `sync.py` sends in chunks. Very long sessions may need trimming of tool outputs.
