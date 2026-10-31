"""Upload existing history to the dashboard: every session in answers.jsonl, plus its transcript.

    python3 scripts/seed.py                  # sessions that have records in the store
    python3 scripts/seed.py --with-asks      # also sessions whose transcript used AskUserQuestion
    python3 scripts/seed.py path/to/x.jsonl  # specific transcripts

Needs STEERABLE_SYNC_URL + STEERABLE_SYNC_TOKEN (or ~/.claude/steerable-agents/sync.json).
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "hooks"))

from common import load_records  # noqa: E402
from sync import config, load_state, pull_reviews, save_state, sync_session  # noqa: E402

PROJECTS = Path.home() / ".claude" / "projects"


def transcript_cwd(path: Path):
    with path.open(encoding="utf-8", errors="replace") as f:
        for raw in f:
            try:
                cwd = json.loads(raw).get("cwd")
            except json.JSONDecodeError:
                continue
            if cwd:
                return cwd
    return None


def main() -> None:
    cfg = config()
    if not cfg:
        sys.exit("Set STEERABLE_SYNC_URL and STEERABLE_SYNC_TOKEN (or write ~/.claude/steerable-agents/sync.json).")
    args = [a for a in sys.argv[1:] if not a.startswith("--")]

    targets = {}  # session_id -> transcript path (or None)
    if args:
        for a in args:
            p = Path(a).expanduser()
            targets[p.stem] = p
    else:
        for r in load_records():
            sid = r.get("session_id")
            if sid:
                targets.setdefault(sid, None)
        if "--with-asks" in sys.argv:
            for p in PROJECTS.glob("*/*.jsonl"):
                if '"name":"AskUserQuestion"' in p.read_text(errors="replace"):
                    targets.setdefault(p.stem, p)

    state = load_state()
    cwd_from_records = {r.get("session_id"): r.get("cwd") for r in load_records()}
    for sid, path in targets.items():
        if path is None:
            path = next(PROJECTS.glob(f"*/{sid}.jsonl"), None)
        cwd = (transcript_cwd(path) if path else None) or cwd_from_records.get(sid)
        try:
            sync_session(sid, str(path) if path else "", cwd, cfg, state)
            save_state(state)
            print(f"{sid}  {'transcript + records' if path else 'records only'}  {cwd or ''}")
        except Exception as e:
            print(f"{sid}  FAILED: {e}", file=sys.stderr)
    print(f"pulled {pull_reviews(cfg)} review(s)")


if __name__ == "__main__":
    main()
