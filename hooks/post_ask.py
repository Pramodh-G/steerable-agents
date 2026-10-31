"""PostToolUse(AskUserQuestion): store each question the user answered."""

from common import append_records, is_child, make_record, read_hook_input


def main() -> None:
    hook_input = read_hook_input()
    if is_child():
        return
    questions = (hook_input.get("tool_input") or {}).get("questions") or []
    response = hook_input.get("tool_response")
    answers = response.get("answers", {}) if isinstance(response, dict) else {}
    annotations = response.get("annotations", {}) if isinstance(response, dict) else {}

    records = []
    for q in questions:
        text = q.get("question")
        if text not in answers:
            continue
        labels = [o.get("label") for o in q.get("options") or []]
        answer = answers[text]
        records.append(make_record(
            hook_input,
            "answer",
            source="user",
            question=text,
            header=q.get("header"),
            options=q.get("options") or [],
            multi_select=bool(q.get("multiSelect")),
            answer=answer,
            free_text=answer not in labels,
            notes=(annotations.get(text) or {}).get("notes"),
        ))
    append_records(records)


if __name__ == "__main__":
    main()
