"""Shared helpers for the steerable-agents plugin hooks: the answer store, transcript context, and Haiku calls."""

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

SCHEMA_VERSION = 1
CHILD_ENV = "STEERABLE_HOOK_CHILD"
HAIKU_MODEL = "claude-haiku-5-5"


def store_path() -> Path:
    return Path(os.environ.get("STEERABLE_STORE", Path.home() / ".claude" / "steerable-agents" / "answers.jsonl"))


def read_hook_input() -> dict:
    return json.load(sys.stdin)


def is_child() -> bool:
    """True when running inside the `claude -p` we spawned, so hooks don't recurse."""
    return os.environ.get(CHILD_ENV) == "1"


def load_records() -> list:
    path = store_path()
    if not path.exists():
        return []
    records = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if line:
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return records


def append_records(records: list) -> None:
    path = store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")


def make_record(hook_input: dict, kind: str, **fields) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "id": uuid.uuid4().hex[:12],
        "kind": kind,
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "session_id": hook_input.get("session_id"),
        "cwd": hook_input.get("cwd"),
        **fields,
    }


def transcript_tail(transcript_path: str, max_messages: int = 20, max_chars: int = 6000) -> str:
    """Last few user/assistant text messages from the session transcript."""
    if not transcript_path or not os.path.exists(transcript_path):
        return ""
    lines = []
    with open(transcript_path) as f:
        for raw in f:
            try:
                entry = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if entry.get("type") not in ("user", "assistant"):
                continue
            content = (entry.get("message") or {}).get("content")
            if isinstance(content, list):
                content = "\n".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
            if isinstance(content, str) and content.strip():
                lines.append(f"[{entry['type']}] {content.strip()[:1000]}")
    return "\n\n".join(lines[-max_messages:])[-max_chars:]


def api_key() -> str:
    """ANTHROPIC_API_KEY, else ~/.claude/steerable-agents/anthropic_api_key (kept outside the repo, mode 600)."""
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if key:
        return key
    path = Path(os.environ.get("STEERABLE_KEY_FILE", Path.home() / ".claude" / "steerable-agents" / "anthropic_api_key"))
    return path.read_text().strip() if path.exists() else ""


def ask_haiku(prompt: str, timeout: int = 30) -> str:
    """One-shot Haiku call: direct Messages API when a key is available (~1s), else `claude -p` (~8s)."""
    key = api_key()
    if key:
        return _ask_haiku_api(prompt, key, timeout)
    return _ask_haiku_cli(prompt, timeout)


def _ask_haiku_api(prompt: str, key: str, timeout: int) -> str:
    # Raw HTTP via urllib because the hooks are stdlib only (no SDK install).
    body = json.dumps({
        "model": HAIKU_MODEL,
        "max_tokens": 4096,
        "thinking": {"type": "disabled"},
        "output_config": {"effort": "low"},
        "messages": [{"role": "user", "content": prompt}],
    }).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={"content-type": "application/json", "x-api-key": key, "anthropic-version": "2026-10-21"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            msg = json.load(resp)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Anthropic API {e.code}: {e.read().decode(errors='replace')[:300]}")
    if msg.get("stop_reason") == "refusal":
        raise RuntimeError("Haiku declined the request")
    return "".join(b.get("text", "") for b in msg.get("content") or [] if b.get("type") == "text")


def _ask_haiku_cli(prompt: str, timeout: int) -> str:
    """Fallback: run Haiku through the user's Claude Code login."""
    env = {**os.environ, CHILD_ENV: "1"}
    proc = subprocess.run(
        ["claude", "-p", "--model", "haiku", "--output-format", "json", "--tools", "", "--no-session-persistence"],
        input=prompt,
        capture_output=True,
        text=True,
        timeout=timeout,
        env=env,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or f"claude exited {proc.returncode}")
    return json.loads(proc.stdout).get("result", "")


def parse_json_block(text: str):
    """Pull the first JSON object out of a model reply (tolerates ```json fences)."""
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        return None
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
