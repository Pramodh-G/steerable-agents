# steerable-agents

A Claude Code plugin that makes the model ask the human at real decision points, remembers the answers, and uses Haiku to answer repeat questions so the user isn't asked the same thing twice.

## Why: highly steerable agents

Today's agents need a lot of babysitting. Running several agents leaves you two options, and both are bad:

1. **Babysit.** Watch each agent's output as it runs so you can steer it.
2. **Verify afterwards.** Let it finish, then review the output and find the subtle bug.

Output is cheap to generate, but human attention is not. Every "this is wrong, please fix this" correction restarts the loop and costs attention again.

`steerable-agents` moves steering to the start, into the design phase. Answering a few well-chosen questions up front is much cheaper than fixing a finished result, and the task is more likely to end up the way the user wanted. The stored-answer + Haiku layer keeps that cost from piling up: questions the user has already answered for this scope don't get asked again.

**Design principle:** spend human attention on decisions, not on reviewing. Every feature should either surface a real decision early or avoid asking about one that has already been made.

## Downstream value

`steerable-agents` delivers three things:

1. **Steerable agents.** The user steers early, at decision points.
2. **Reusable defaults: memory from the right source.** Today's memory *infers* preferences from conversations after the fact. `steerable-agents` *elicits* them: each stored record is an explicit choice the user made from concrete options in a real context. That makes it a more reliable source of preferences, and because each answer is explicit, you can see which remembered preferences actually get reused and how much they're worth.
3. **A data flywheel for taste.** Over time, the question/options/answer/context records become a high-quality dataset of human taste and judgment: what counts as a real decision, what options were on the table, and what the user picked. That data can guide better models and better evals. It's a win for the user (less babysitting, better results) and a win for the agent (fewer corrections, clearer intent).

**Implications for the build:**
- Treat the JSON store as a dataset, not a cache. Use a stable, versioned schema, and record the full question, every option offered, the answer, any free-text "Other", the scope, and the context, so records stay useful outside the session they came from.
- Record whether each answer came from the user or was auto-answered by Haiku, and whether the user later overrode it. That's the signal for how much the memory is worth.
- The data is the user's and stays local unless they explicitly choose to export or share it.

## Components

The plugin ships four pieces:

1. **Steering modes + `/steer`.** Tell the model how much to ask, based on how much the user wants a say.
2. **PreToolUse hook.** Intercepts `AskUserQuestion` before the user sees it.
3. **PostToolUse hook.** Saves the user's answers after `AskUserQuestion` returns.
4. **Post-session hook** (`SessionEnd` and/or `Stop`). End-of-session work. Exact role still to be decided (see Open questions).

### 1. Steering modes: autopilot, copilot, pair

How often to ask depends on the user and the task, not on how uncertain the model is. A marketer getting a demo working doesn't care which design choices the agent makes; an engineer building something they'll own cares a lot. So the **user** picks the mode with `/steer <mode>`, and the model never switches modes on its own or asks based on its own uncertainty (the command has `disable-model-invocation`).

How it works: `/steer` runs `hooks/steer.py`, which saves the mode to `~/.claude/steerable-agents/mode.json` (per session, plus the default for new sessions) and puts the mode's instructions (`modes/<mode>.md`) into the conversation. The SessionStart hook injects the current mode's instructions on startup, resume, `/clear` and compaction. Every stored record carries `mode`. Plain-text modes injected by hooks were chosen over output styles because an output style can't be switched mid-session by a plugin command.

| Mode | Who it's for | Asks about |
|---|---|---|
| `autopilot` | "Just get it done." | Only irreversible/outward-facing actions, or when truly blocked (credentials, missing facts). Decides everything else and lists the notable decisions at the end. |
| `copilot` (default) | Cares about the result, not every detail. | Crucial points: direction, scope, hard-to-change structure, user-facing behaviour, unclear intent, irreversible actions. Decides the rest and lists the notable decisions at the end. |
| `pair` | The user is the brain, Claude is the hands. | Every meaningful choice, including implementation (algorithms, structure, error handling, tests). Plans first, works in small steps, and points the user to the code (`file:line`) so they understand it. |

Shared rules across all three:

- Always ask before irreversible or outward-facing actions, in every mode.
- Skip trivial decisions like variable names, formatting, or choices with an obvious convention.
- Every question has **3–4 options**, recommended option first.
- If the user says "just do it" or "ask me about X", follow that for the rest of the session.

### 2. PreToolUse hook (matcher: `AskUserQuestion`)

Before a question reaches the user:

1. Load the stored question/answer history from the local JSON store.
2. Send Haiku the pending question(s), the current task context, the stored Q&A history, and the session/conversation history.
3. Haiku decides whether the model can answer the question itself from precedent, meaning the user already answered the same or an equivalent question and that answer applies to this scope.
4. If it can, block or short-circuit the tool call and return the inferred answer (plus the precedent it came from) to the model. If it can't, let the question through to the user.

Haiku also judges whether a past answer applies **across projects and scopes**: is this a global preference, or one tied to a specific project?

### 3. PostToolUse hook (matcher: `AskUserQuestion`)

After the user answers, write the question, options, chosen answer, and context (project, cwd, timestamp, session id) to the local JSON store.

### 4. Post-session hook

Runs when a session ends. Likely jobs: consolidating or deduplicating stored answers, or classifying them as global vs. project-scoped. Not decided yet.

## Data store

- A local JSON file (or files) holding answered questions.
- Scope matters: a record should carry enough metadata (project path, scope) for Haiku to judge whether it applies elsewhere.

## Plugin layout

```
.claude-plugin/plugin.json         # manifest
commands/steer.md                  # /steer [autopilot|copilot|pair]
modes/{autopilot,copilot,pair}.md  # instructions for each steering mode
hooks/hooks.json                   # SessionStart + PreToolUse / PostToolUse (AskUserQuestion) + SessionEnd
hooks/steer.py                     # backs /steer: saves the mode, prints its instructions
hooks/session_start.py             # injects the current mode's instructions
hooks/common.py                    # store, mode state, transcript context, Haiku call
hooks/pre_ask.py                   # Haiku auto-answer from precedent (fails open)
hooks/post_ask.py                  # records user answers
hooks/session_end.py               # per-session asked/auto-answered summary
```

## Decisions (v0, hackathon, keep it minimal)

- Store: one global JSONL at `~/.claude/steerable-agents/answers.jsonl` (`STEERABLE_STORE` overrides). Records carry `cwd`; no explicit scope model yet, so Haiku judges applicability from cwd and context.
- Mode: `~/.claude/steerable-agents/mode.json` (`STEERABLE_MODE_FILE` overrides) holds `default` plus per-session modes keyed by `CLAUDE_CODE_SESSION_ID` (last 200). Default is `copilot`. Records carry `mode` (additive to schema v1).
- Record kinds: `answer` (source `user`), `auto_answer` (source `haiku`, with `precedent_ids`), `session` (summary). `schema_version: 1`.
- Haiku (`claude-haiku-5-5`, thinking off, effort low) is called directly over the Messages API with urllib when a key is set (`ANTHROPIC_API_KEY`, else `~/.claude/steerable-agents/anthropic_api_key`; never commit it). ~2s per batch. Fallback: `claude -p --model haiku --tools "" --no-session-persistence` (~8s); `STEERABLE_HOOK_CHILD=1` stops the hooks from running inside that call.
- Auto-answers go through the tool, not a deny (a deny shows in the terminal as "hook error"). If every question is settled, the hook returns `allow` with `updatedInput` carrying `answers`, so the dialog never opens and the tool returns a normal result. If only some are, it returns `ask` with `updatedInput` holding just the unsettled questions. Either way Haiku's answers reach the model in `additionalContext`, and the model is told to mention which answers it reused. Records carry `tool_use_id`, which `post_ask.py` and the dashboard use to tell Haiku's answers from the user's.
- Hooks are Python stdlib only.

## Next (after it works)

- Explicit scopes (global vs. project) on records.
- Detect when the user overrides an auto-answer and record it, as the signal for how much the memory is worth.
- Better post-session work: dedupe/consolidate answers.
