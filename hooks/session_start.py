"""SessionStart: load the current steering mode's instructions into the session (also after /clear and compaction)."""

import json

from common import current_mode, is_child, mode_instructions, read_hook_input


def main() -> None:
    hook_input = read_hook_input()
    if is_child():
        return
    mode = current_mode(hook_input.get("session_id"))
    context = (f"[steerable-agents] Steering mode: **{mode}** (the user can change it with /steer).\n\n"
               + mode_instructions(mode))
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": context}}))


if __name__ == "__main__":
    main()
