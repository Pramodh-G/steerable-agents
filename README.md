# human

Steerable agents for Claude Code. `human` makes Claude ask you at real decision points instead of guessing, saves your answers, and uses Haiku to answer repeat questions from those saved answers, so you steer early and only get asked once.

## What's inside

- **Output style `human`**: tells Claude to use AskUserQuestion at forks, design decisions and irreversible actions, with 3–4 options per question. It skips trivial choices.
- **PreToolUse (AskUserQuestion)**: before a question reaches you, Haiku (`claude -p --model haiku`) checks your saved answers plus the session context. Questions it can settle are answered for you, and Claude tells you which answers it reused so you can override them. Anything else is asked as normal. If the check fails, the question goes through to you.
- **PostToolUse (AskUserQuestion)**: saves every answered question to `~/.claude/human/answers.jsonl`.
- **SessionEnd**: writes a per-session summary (how many questions you answered vs. how many Haiku answered).

## Try it

```bash
claude --plugin-dir /path/to/human
# then: /output-style human
```

Requires `python3` and a logged-in `claude` CLI. Set `HUMAN_STORE=/some/file.jsonl` to use a different answer store.
