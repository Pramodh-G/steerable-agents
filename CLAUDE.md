# human

A Claude Code plugin that makes the model ask the human at real decision points, remembers the answers, and uses Haiku to answer repeat questions so the user isn't asked the same thing twice.

## Why: highly steerable agents

Today's agents need a lot of babysitting. Running several agents leaves you two options, and both are bad:

1. **Babysit.** Watch each agent's output as it runs so you can steer it.
2. **Verify afterwards.** Let it finish, then review the output and find the subtle bug.

Output is cheap to generate, but human attention is not. Every "this is wrong, please fix this" correction restarts the loop and costs attention again.

`human` moves steering to the start, into the design phase. Answering a few well-chosen questions up front is much cheaper than fixing a finished result, and the task is more likely to end up the way the user wanted. The stored-answer + Haiku layer keeps that cost from piling up: questions the user has already answered for this scope don't get asked again.

**Design principle:** spend human attention on decisions, not on reviewing. Every feature should either surface a real decision early or avoid asking about one that has already been made.

## Downstream value

`human` delivers three things:

1. **Steerable agents.** The user steers early, at decision points.
2. **Reusable defaults: memory from the right source.** Today's memory *infers* preferences from conversations after the fact. `human` *elicits* them: each stored record is an explicit choice the user made from concrete options in a real context. That makes it a more reliable source of preferences, and because each answer is explicit, you can see which remembered preferences actually get reused and how much they're worth.
3. **A data flywheel for taste.** Over time, the question/options/answer/context records become a high-quality dataset of human taste and judgment: what counts as a real decision, what options were on the table, and what the user picked. That data can guide better models and better evals. It's a win for the user (less babysitting, better results) and a win for the agent (fewer corrections, clearer intent).

**Implications for the build:**
- Treat the JSON store as a dataset, not a cache. Use a stable, versioned schema, and record the full question, every option offered, the answer, any free-text "Other", the scope, and the context, so records stay useful outside the session they came from.
- Record whether each answer came from the user or was auto-answered by Haiku, and whether the user later overrode it. That's the signal for how much the memory is worth.
- The data is the user's and stays local unless they explicitly choose to export or share it.

## Components

The plugin ships four pieces:

1. **Output style: `human`.** Tells the model to ask instead of assume.
2. **PreToolUse hook.** Intercepts `AskUserQuestion` before the user sees it.
3. **PostToolUse hook.** Saves the user's answers after `AskUserQuestion` returns.
4. **Post-session hook** (`SessionEnd` and/or `Stop`). End-of-session work. Exact role still to be decided (see Open questions).

### 1. Output style: `human`

The style prompt should tell the model:

- At every fork, design decision, or anything non-trivial that comes down to human preference, ask out loud with `AskUserQuestion`. Don't assume.
- Be especially careful with irreversible actions: always ask before doing one.
- Skip trivial decisions like variable names, formatting, or choices with an obvious convention.
- Every question has **3–4 options**.
- There's no cap on the number of questions. Ask as many as the task needs.

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

## Plugin layout (planned)

```
.claude-plugin/plugin.json   # manifest
output-styles/human.md       # the "human" output style
hooks/hooks.json             # PreToolUse / PostToolUse / SessionEnd registrations
hooks/*                      # hook scripts
```

## Open questions

- Where does the JSON store live: global (`~/.claude/...`), per project, or both?
- What does the post-session hook actually do?
- When Haiku auto-answers, should the user be told or able to override, or should it happen silently?
- What confidence threshold does Haiku need before it answers instead of asking?
- Which language for the hook scripts, and how do we call Haiku (Anthropic SDK with an API key, or `claude -p --model haiku`)?
