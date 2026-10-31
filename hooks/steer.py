"""Backs the /steer command: `steer.py [autopilot|copilot|pair]` sets the mode and prints its instructions."""

import os
import sys

from common import MODES, current_mode, mode_instructions, set_mode

BLURBS = {
    "autopilot": "does the task on its own; asks only before irreversible actions or when blocked",
    "copilot": "asks at the crucial decisions, decides the rest",
    "pair": "asks about every meaningful choice; you're the brain, Claude types",
}


def main() -> None:
    session_id = os.environ.get("CLAUDE_CODE_SESSION_ID")
    arg = " ".join(sys.argv[1:]).strip().lower()

    if not arg:
        mode = current_mode(session_id)
        print(f"Steering mode is **{mode}**. Available modes:")
        for m in MODES:
            print(f"- `/steer {m}`: {BLURBS[m]}")
        print("\nShow this to the user as is. Don't change the mode or do anything else.")
        return

    if arg not in MODES:
        print(f'Unknown mode "{arg}". Tell the user to use one of: ' + ", ".join(f"`/steer {m}`" for m in MODES) + ". Don't do anything else.")
        return

    set_mode(arg, session_id)
    print(f"[steerable-agents] The user switched the steering mode to **{arg}**. "
          "These instructions replace any earlier steering mode for the rest of the session:\n")
    print(mode_instructions(arg))
    print(f"\nConfirm in one line that you're now in {arg} mode ({BLURBS[arg]}), then continue where you left off, if there's anything to continue.")


if __name__ == "__main__":
    main()
