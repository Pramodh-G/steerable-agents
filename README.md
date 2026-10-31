# steerable-agents

Steerable agents for Claude Code. `steerable-agents` makes Claude ask you at real decision points instead of guessing, saves your answers, and uses Haiku to answer repeat questions from those saved answers, so you steer early and only get asked once.

## What's inside

- **Output style `steerable-agents`**: tells Claude to use AskUserQuestion at forks, design decisions and irreversible actions, with 3–4 options per question. It skips trivial choices.
- **PreToolUse (AskUserQuestion)**: before a question reaches you, Haiku (`claude-haiku-5-5`) checks your saved answers plus the session context. Questions it can settle are answered for you, and Claude tells you which answers it reused so you can override them. Anything else is asked as normal. If the check fails, the question goes through to you.
- **PostToolUse (AskUserQuestion)**: saves every answered question to `~/.claude/steerable-agents/answers.jsonl`.
- **SessionEnd**: writes a per-session summary (how many questions you answered vs. how many Haiku answered).

## Try it

```bash
claude --plugin-dir /path/to/steerable-agents
# then: /output-style steerable-agents
```

Requires `python3`. For fast checks (~2s), put an Anthropic API key in `ANTHROPIC_API_KEY` or `~/.claude/steerable-agents/anthropic_api_key` (mode 600, never in the repo). Without one it falls back to `claude -p` (~8s), which needs a logged-in `claude` CLI. Set `STEERABLE_STORE=/some/file.jsonl` to use a different answer store.
