"""Stop + SessionEnd: sync this session's transcript and records to the hosted dashboard, and pull reviews back.

PostToolUse runs `sync.py --live`: it hands off to a detached `--bg` process and returns at once, so the
dashboard grows during a long turn without slowing tool calls. A lock keeps syncs from overlapping; a
background sync that finds it held just skips (the next tool call or Stop catches up).

Opt-in: does nothing unless STEERABLE_SYNC_URL + STEERABLE_SYNC_TOKEN are set, or
~/.claude/steerable-agents/sync.json holds {"url": ..., "token": ...}. Fails silent: errors go to stderr,
nothing is printed to stdout (Stop hook stdout can block the session).
"""

import fcntl
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from common import append_records, is_child, load_records, store_path

CHUNK_BYTES = 2_000_000  # Vercel caps request bodies at 4.5 MB
TIMEOUT = 8


def base_dir() -> Path:
    return store_path().parent


def config():
    url = os.environ.get("STEERABLE_SYNC_URL", "").strip()
    token = os.environ.get("STEERABLE_SYNC_TOKEN", "").strip()
    if not (url and token):
        path = base_dir() / "sync.json"
        if path.exists():
            try:
                cfg = json.loads(path.read_text())
                url, token = url or cfg.get("url", ""), token or cfg.get("token", "")
            except (OSError, json.JSONDecodeError):
                pass
    return (url.rstrip("/"), token) if url and token else None


def _state_path() -> Path:
    return base_dir() / "sync_state.json"


def load_state() -> dict:
    try:
        return json.loads(_state_path().read_text())
    except (OSError, json.JSONDecodeError):
        return {}


def save_state(state: dict) -> None:
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state))
    tmp.replace(path)


def _request(cfg, method: str, path: str, body=None):
    url, token = cfg
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url + path,
        data=data,
        method=method,
        headers={"authorization": f"Bearer {token}", "content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.load(resp)


def read_new_lines(transcript_path: str, offset: int):
    """Complete lines from line number `offset` on. A trailing line without a newline may still be mid-write."""
    out = []
    if not transcript_path or not os.path.exists(transcript_path):
        return out
    with open(transcript_path, encoding="utf-8", errors="replace") as f:
        for n, raw in enumerate(f):
            if n < offset:
                continue
            if not raw.endswith("\n"):
                break
            try:
                entry = json.loads(raw)
            except json.JSONDecodeError:
                entry = {"type": "unparsed", "raw": raw[:2000]}
            out.append((n, entry, len(raw)))
    return out


def sync_session(session_id: str, transcript_path: str, cwd: str, cfg=None, state=None) -> None:
    """Send new transcript lines (chunked) plus all of this session's records. Server upserts, so retries are safe."""
    cfg = cfg or config()
    if not cfg or not session_id:
        return
    own_state = state is None
    state = load_state() if own_state else state
    offset = int(state.get(session_id, 0))
    lines = read_new_lines(transcript_path, offset)
    records = [r for r in load_records() if r.get("session_id") == session_id]
    session = {"id": session_id, "cwd": cwd}

    chunks, cur, size = [], [], 0
    for n, entry, nbytes in lines:
        if cur and size + nbytes > CHUNK_BYTES:
            chunks.append(cur)
            cur, size = [], 0
        cur.append((n, entry))
        size += nbytes
    chunks.append(cur)  # last (possibly empty) chunk carries the records

    for i, chunk in enumerate(chunks):
        last = i == len(chunks) - 1
        _request(cfg, "POST", "/api/ingest", {
            "session": session,
            "lines": [{"n": n, "entry": e} for n, e in chunk],
            "records": records if last else [],
        })
        if chunk:
            state[session_id] = chunk[-1][0] + 1
            if own_state:
                save_state(state)


def pull_reviews(cfg=None) -> int:
    """Append dashboard accepts/overrides to the local store as `review` records."""
    cfg = cfg or config()
    if not cfg:
        return 0
    local = load_records()
    seen = {r.get("id") for r in local}
    since = max((r.get("ts") or "" for r in local if r.get("kind") == "review"), default="")
    query = "?" + urllib.parse.urlencode({"since": since}) if since else ""
    resp = _request(cfg, "GET", "/api/reviews" + query)
    new = [r for r in resp.get("reviews") or [] if r.get("id") and r.get("id") not in seen]
    append_records(new)
    return len(new)


def _lock(block: bool):
    """Exclusive sync lock, or None if `block` is False and another sync holds it."""
    path = base_dir() / "sync.lock"
    path.parent.mkdir(parents=True, exist_ok=True)
    f = open(path, "w")
    try:
        fcntl.flock(f, fcntl.LOCK_EX | (0 if block else fcntl.LOCK_NB))
    except BlockingIOError:
        f.close()
        return None
    return f


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    raw = sys.stdin.read()
    if is_child():
        return
    cfg = config()
    if not cfg:
        return
    if mode == "--live":
        proc = subprocess.Popen(
            [sys.executable, os.path.abspath(__file__), "--bg"],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True,
        )
        proc.stdin.write(raw.encode())
        proc.stdin.close()
        return
    lock = _lock(block=mode != "--bg")
    if not lock:
        return
    hook_input = json.loads(raw)
    try:
        sync_session(hook_input.get("session_id"), hook_input.get("transcript_path"), hook_input.get("cwd"), cfg)
        if mode != "--bg":
            pull_reviews(cfg)
    except (urllib.error.URLError, OSError, ValueError) as e:
        print(f"steerable-agents: sync skipped ({e})", file=sys.stderr)
    finally:
        lock.close()


if __name__ == "__main__":
    main()
