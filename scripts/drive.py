"""Drive a real Claude Code session with the plugin loaded, relaying AskUserQuestion to a human through files.

Demo tooling, not part of the plugin (needs `pip install claude-agent-sdk`). Questions Haiku settles never
reach this script (pre_ask.py answers them through the tool). The rest are written to
<relay>/<name>.pending.json; the session waits until <relay>/<name>.answer.json holds {"<question>": "<answer>"}.

    python drive.py <name> <cwd> "<task prompt>" [--relay DIR]
"""

import argparse
import asyncio
import json
import os
from pathlib import Path

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    PermissionResultAllow,
    PermissionResultDeny,
    ResultMessage,
    TextBlock,
)

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
# Only local build/test commands run without asking; anything else is denied.
ALLOWED_BASH = ["npm install", "npm test", "npm run", "node ", "python3 ", "python -m", "pytest", "mkdir ", "ls", "cat ", "git status", "git diff"]


async def relay_question(relay: Path, name: str, tool_input: dict) -> dict:
    pending, answer = relay / f"{name}.pending.json", relay / f"{name}.answer.json"
    answer.unlink(missing_ok=True)
    pending.write_text(json.dumps(tool_input["questions"], indent=1))
    print(f"[{name}] waiting for answers: {pending}", flush=True)
    while not answer.exists():
        await asyncio.sleep(1)
    answers = json.loads(answer.read_text())
    pending.unlink(missing_ok=True)
    answer.unlink(missing_ok=True)
    return answers


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("name")
    ap.add_argument("cwd")
    ap.add_argument("prompt")
    ap.add_argument("--relay", default=str(Path.home() / ".claude" / "steerable-agents" / "relay"))
    args = ap.parse_args()
    relay = Path(args.relay)
    relay.mkdir(parents=True, exist_ok=True)

    async def can_use_tool(tool_name, tool_input, context):
        if tool_name == "AskUserQuestion":
            answers = await relay_question(relay, args.name, tool_input)
            return PermissionResultAllow(updated_input={**tool_input, "answers": answers})
        cmd = tool_input.get("command", "").strip()
        if tool_name == "Bash" and cmd.startswith(tuple(ALLOWED_BASH)) and not any(c in cmd for c in (";", "&&", "||", "|", "`", "$(", ">")):
            return PermissionResultAllow(updated_input=tool_input)
        return PermissionResultDeny(message="Not allowed in this demo session; stick to editing files and local build/test commands.")

    options = ClaudeAgentOptions(
        cwd=args.cwd,
        permission_mode="acceptEdits",
        plugins=[{"type": "local", "path": str(PLUGIN_ROOT)}],
        setting_sources=["user", "project"],
        can_use_tool=can_use_tool,
        env={"PATH": os.environ["PATH"]},
    )
    async with ClaudeSDKClient(options=options) as client:
        await client.query(args.prompt)
        async for msg in client.receive_response():
            if isinstance(msg, AssistantMessage):
                for block in msg.content:
                    if isinstance(block, TextBlock) and block.text.strip():
                        print(f"[{args.name}] {block.text.strip()[:400]}", flush=True)
            elif isinstance(msg, ResultMessage):
                print(f"[{args.name}] done: session {msg.session_id}, cost ${msg.total_cost_usd or 0:.2f}", flush=True)
    (relay / f"{args.name}.done").write_text("1")


if __name__ == "__main__":
    asyncio.run(main())
