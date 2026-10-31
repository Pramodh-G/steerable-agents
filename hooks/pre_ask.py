"""PreToolUse(AskUserQuestion): let Haiku answer questions the user has already answered before.

Fails open: any error or uncertainty lets the question through to the user.
"""

import json
import sys

from human_common import (
    append_records,
    ask_haiku,
    is_child,
    load_records,
    make_record,
    parse_json_block,
    read_hook_input,
    transcript_tail,
)

MAX_PRECEDENTS = 200

PROMPT = """You decide whether an AI coding agent can answer its own questions using the user's past answers, instead of interrupting the user.

## Past answers from the user (JSONL)
{precedents}

## Recent conversation in the current session
{context}

## Current working directory
{cwd}

## Questions the agent wants to ask now
{questions}

For each question, decide whether a past answer clearly settles it for this situation. Only mark a question
answerable if the user has already made the same or an equivalent decision and it obviously applies here
(e.g. a general preference, or the same project). When in doubt, it is NOT answerable; asking is cheap, a wrong
assumption is expensive. Never invent preferences.

Reply with only JSON:
{{"answers": [{{"question": "<exact question text>", "answerable": true|false, "answer": "<option label or short answer>", "precedent_ids": ["<id>"], "reason": "<one sentence>"}}]}}"""


def main() -> None:
    hook_input = read_hook_input()
    if is_child():
        return
    questions = (hook_input.get("tool_input") or {}).get("questions") or []
    precedents = [r for r in load_records() if r.get("kind") == "answer"][-MAX_PRECEDENTS:]
    if not questions or not precedents:
        return

    prompt = PROMPT.format(
        precedents="\n".join(
            json.dumps({k: r.get(k) for k in ("id", "cwd", "question", "options", "answer")}) for r in precedents
        ),
        context=transcript_tail(hook_input.get("transcript_path")) or "(none)",
        cwd=hook_input.get("cwd"),
        questions=json.dumps(questions, indent=1),
    )
    try:
        verdict = parse_json_block(ask_haiku(prompt)) or {}
    except Exception as e:  # fail open
        print(f"human: Haiku check skipped ({e})", file=sys.stderr)
        return

    asked = {q.get("question") for q in questions}
    answered = [
        a for a in verdict.get("answers") or []
        if a.get("answerable") and a.get("answer") and a.get("question") in asked
    ]
    if not answered:
        return

    append_records([
        make_record(
            hook_input,
            "auto_answer",
            source="haiku",
            question=a["question"],
            answer=a["answer"],
            precedent_ids=a.get("precedent_ids") or [],
            reason=a.get("reason"),
        )
        for a in answered
    ])

    answered_qs = {a["question"] for a in answered}
    remaining = [q for q in questions if q.get("question") not in answered_qs]
    lines = ["[human] The user has already answered these in past sessions, so they were not asked again:"]
    for a in answered:
        lines.append(f'- "{a["question"]}" -> {a["answer"]} (precedent: {", ".join(a.get("precedent_ids") or []) or "n/a"}; {a.get("reason", "")})')
    lines.append("Proceed with these answers. Tell the user in one short line which answers you reused, so they can override.")
    if remaining:
        lines.append("Re-ask ONLY these remaining questions with AskUserQuestion: " + "; ".join(f'"{q.get("question")}"' for q in remaining))

    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": "\n".join(lines),
        }
    }))


if __name__ == "__main__":
    main()
