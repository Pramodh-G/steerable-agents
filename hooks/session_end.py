"""SessionEnd: write a per-session summary (questions asked vs. auto-answered) to the store."""

from human_common import append_records, is_child, load_records, make_record, read_hook_input


def main() -> None:
    hook_input = read_hook_input()
    if is_child():
        return
    sid = hook_input.get("session_id")
    mine = [r for r in load_records() if r.get("session_id") == sid]
    asked = sum(r.get("kind") == "answer" for r in mine)
    auto = sum(r.get("kind") == "auto_answer" for r in mine)
    if asked or auto:
        append_records([make_record(
            hook_input,
            "session",
            reason=hook_input.get("reason"),
            asked_user=asked,
            auto_answered=auto,
        )])


if __name__ == "__main__":
    main()
