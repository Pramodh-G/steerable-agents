# steerable-agents

Steerable agents for Claude Code. `steerable-agents` makes Claude ask you at real decision points instead of guessing, saves your answers, and uses Haiku to answer repeat questions from those saved answers, so you steer early and only get asked once.

## What's inside

- **`/steer` and three steering modes.** You pick how much say you want; Claude doesn't decide that from its own uncertainty. Switch any time with `/steer <mode>` (`/steer` alone shows the current mode). The mode applies to the current session right away and becomes the default for new ones. Every question has 3–4 options, and all three modes ask before irreversible actions.
  - `autopilot`: gets it done on its own. Asks only before irreversible actions or when truly blocked, and lists the decisions it made at the end.
  - `copilot` (default): asks at the crucial decisions (direction, scope, structure that's hard to change, user-facing behaviour) and decides the rest.
  - `pair`: you're the brain, Claude types. Asks about every meaningful design and implementation choice and points you to the code as it goes.
- **SessionStart**: loads the current mode's instructions into the session (again after `/clear` and compaction).
- **PreToolUse (AskUserQuestion)**: before a question reaches you, Haiku (`claude-haiku-5-5`) checks your saved answers plus the session context. Questions it can settle are answered for you, and Claude tells you which answers it reused so you can override them. Anything else is asked as normal. If the check fails, the question goes through to you.
- **PostToolUse (AskUserQuestion)**: saves every answered question to `~/.claude/steerable-agents/answers.jsonl`.
- **SessionEnd**: writes a per-session summary (how many questions you answered vs. how many Haiku answered).

## Try it

```bash
claude --plugin-dir /path/to/steerable-agents
# then pick a mode: /steer autopilot | /steer copilot | /steer pair
# (if another plugin also has a /steer: /steerable-agents:steer pair)
```

Requires `python3`. For fast checks (~2s), put an Anthropic API key in `ANTHROPIC_API_KEY` or `~/.claude/steerable-agents/anthropic_api_key` (mode 600, never in the repo). Without one it falls back to `claude -p` (~8s), which needs a logged-in `claude` CLI. Set `STEERABLE_STORE=/some/file.jsonl` to use a different answer store. The mode lives in `~/.claude/steerable-agents/mode.json` (`STEERABLE_MODE_FILE` overrides).
