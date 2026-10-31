// Turns raw transcript lines + store records into the decision-compressed timeline.
// Pure (no server imports) so it can be tested directly against real transcripts.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type StoreRecord = {
  id: string;
  kind: string;
  source?: string;
  ts?: string;
  session_id?: string;
  cwd?: string;
  question?: string;
  answer?: string;
  options?: Option[];
  notes?: string | null;
  reason?: string;
  precedent_ids?: string[];
  auto_answer_id?: string;
  verdict?: "accept" | "override";
  [k: string]: unknown;
};

export type Option = { label: string; description?: string };

export type Step =
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "diff"; tool: string; file: string; edits: { old: string; new: string }[] }
  | { type: "tool"; name: string; summary: string; result?: string; isError?: boolean };

export type Question = {
  question: string;
  header?: string;
  options: Option[];
  multiSelect?: boolean;
};

export type Item =
  | { kind: "prompt"; text: string; ts?: string }
  | { kind: "segment"; steps: Step[]; summary: string }
  | {
      kind: "user_decision";
      q: Question;
      answer: string;
      notes?: string | null;
      record?: StoreRecord;
      ts?: string;
    }
  | {
      kind: "auto_decision";
      q: Question;
      record: StoreRecord;
      review?: StoreRecord;
      ts?: string;
    }
  | { kind: "pending_decision"; q: Question; ts?: string };

export type TranscriptLine = { line_no: number; entry: any };

const RESULT_MAX = 2000;

function truncate(s: string, n = RESULT_MAX): string {
  return s.length > n ? s.slice(0, n) + `\n… (${s.length - n} more chars)` : s;
}

function resultText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((b) => (b?.type === "text" ? b.text : b?.type === "image" ? "[image]" : ""))
      .filter(Boolean)
      .join("\n");
  return content == null ? "" : JSON.stringify(content);
}

function isWrapper(text: string): boolean {
  const t = text.trimStart();
  return (
    t.startsWith("<command-") ||
    t.startsWith("<local-command") ||
    t.startsWith("<system-reminder>") ||
    t.startsWith("<task-notification") ||
    t.startsWith("[Request interrupted")
  );
}

function toolSummary(name: string, input: any): string {
  const i = input || {};
  switch (name) {
    case "Bash":
      return i.description || i.command || "";
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return i.file_path || i.notebook_path || "";
    case "Grep":
      return `${i.pattern ?? ""}${i.path ? ` in ${i.path}` : ""}`;
    case "Glob":
      return i.pattern || "";
    case "Agent":
    case "Task":
      return i.description || "";
    case "WebFetch":
      return i.url || "";
    case "WebSearch":
      return i.query || "";
    default: {
      const s = JSON.stringify(i);
      return s.length > 160 ? s.slice(0, 160) + "…" : s;
    }
  }
}

function diffStep(name: string, input: any): Step | null {
  const file = input?.file_path || "";
  if (name === "Edit") return { type: "diff", tool: name, file, edits: [{ old: input.old_string ?? "", new: input.new_string ?? "" }] };
  if (name === "MultiEdit")
    return {
      type: "diff",
      tool: name,
      file,
      edits: (input.edits || []).map((e: any) => ({ old: e.old_string ?? "", new: e.new_string ?? "" })),
    };
  if (name === "Write") return { type: "diff", tool: name, file, edits: [{ old: "", new: input.content ?? "" }] };
  return null;
}

/** "thought · edited 2 files · ran 4 commands" */
export function summarize(steps: Step[]): string {
  let thought = false;
  let messages = 0;
  const edited = new Set<string>();
  const read = new Set<string>();
  let commands = 0;
  let searches = 0;
  let agents = 0;
  let other = 0;
  let errors = 0;
  for (const s of steps) {
    if (s.type === "thinking") thought = true;
    else if (s.type === "text") messages++;
    else if (s.type === "diff") edited.add(s.file);
    else {
      if (s.isError) errors++;
      if (s.name === "Bash") commands++;
      else if (s.name === "Read") read.add(s.summary);
      else if (s.name === "Grep" || s.name === "Glob" || s.name === "WebSearch") searches++;
      else if (s.name === "Agent" || s.name === "Task") agents++;
      else other++;
    }
  }
  const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  if (thought) parts.push("thought");
  if (messages) parts.push(plural(messages, "message"));
  if (read.size) parts.push(`read ${plural(read.size, "file")}`);
  if (searches) parts.push(plural(searches, "search", "searches"));
  if (edited.size) parts.push(`edited ${plural(edited.size, "file")}`);
  if (commands) parts.push(`ran ${plural(commands, "command")}`);
  if (agents) parts.push(plural(agents, "subagent"));
  if (other) parts.push(plural(other, "other tool call"));
  if (errors) parts.push(plural(errors, "error"));
  return parts.join(" · ") || "working";
}

function normalizeQuestion(q: any): Question {
  return {
    question: String(q?.question ?? ""),
    header: q?.header,
    options: Array.isArray(q?.options) ? q.options.map((o: any) => ({ label: String(o?.label ?? o), description: o?.description })) : [],
    multiSelect: !!q?.multiSelect,
  };
}

/** Latest review per auto_answer id. */
export function latestReviews(records: StoreRecord[]): Map<string, StoreRecord> {
  const out = new Map<string, StoreRecord>();
  for (const r of records) {
    if (r.kind !== "review" || !r.auto_answer_id) continue;
    const prev = out.get(r.auto_answer_id);
    if (!prev || String(r.ts ?? "") >= String(prev.ts ?? "")) out.set(r.auto_answer_id, r);
  }
  return out;
}

export function buildTimeline(lines: TranscriptLine[], records: StoreRecord[]): { title: string | null; items: Item[] } {
  const byTs = (a: StoreRecord, b: StoreRecord) => String(a.ts ?? "").localeCompare(String(b.ts ?? ""));
  const answers = records.filter((r) => r.kind === "answer").sort(byTs);
  const autos = records.filter((r) => r.kind === "auto_answer").sort(byTs);
  const reviews = latestReviews(records);
  const used = new Set<string>();
  const take = (pool: StoreRecord[], question: string) => {
    const r = pool.find((x) => !used.has(x.id) && x.question === question);
    if (r) used.add(r.id);
    return r;
  };

  let title: string | null = null;
  const items: Item[] = [];
  let steps: Step[] = [];
  const flush = () => {
    if (steps.length) items.push({ kind: "segment", steps, summary: summarize(steps) });
    steps = [];
  };

  const toolSteps = new Map<string, Step>(); // tool_use_id -> tool step (to attach results)
  const asks = new Map<string, { questions: Question[]; ts?: string }>(); // pending AskUserQuestion calls

  const sorted = [...lines].sort((a, b) => a.line_no - b.line_no);
  for (const { entry: e } of sorted) {
    if (!e || typeof e !== "object" || e.isSidechain) continue;
    if (e.type === "ai-title" && e.aiTitle) {
      title = e.aiTitle;
      continue;
    }
    if (e.type === "assistant") {
      for (const b of e.message?.content || []) {
        if (b?.type === "thinking") {
          if (b.thinking?.trim()) steps.push({ type: "thinking", text: b.thinking });
          else if (!steps.some((s) => s.type === "thinking")) steps.push({ type: "thinking", text: "" });
        } else if (b?.type === "text" && b.text?.trim()) {
          steps.push({ type: "text", text: b.text });
        } else if (b?.type === "tool_use") {
          if (b.name === "AskUserQuestion") {
            asks.set(b.id, { questions: (b.input?.questions || []).map(normalizeQuestion), ts: e.timestamp });
            continue;
          }
          const step = diffStep(b.name, b.input) ?? { type: "tool" as const, name: b.name, summary: toolSummary(b.name, b.input) };
          toolSteps.set(b.id, step);
          steps.push(step);
        }
      }
      continue;
    }
    if (e.type !== "user") continue;
    const content = e.message?.content;
    if (typeof content === "string" || (Array.isArray(content) && !content.some((b: any) => b?.type === "tool_result"))) {
      if (e.isMeta) continue;
      const text = typeof content === "string" ? content : content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n");
      if (!text.trim() || isWrapper(text)) continue;
      flush();
      items.push({ kind: "prompt", text, ts: e.timestamp });
      continue;
    }
    for (const b of content || []) {
      if (b?.type !== "tool_result") continue;
      const ask = asks.get(b.tool_use_id);
      if (ask) {
        asks.delete(b.tool_use_id);
        flush();
        const tur = e.toolUseResult;
        const given = tur && typeof tur === "object" && tur.answers && typeof tur.answers === "object" ? tur.answers : null;
        for (const q of ask.questions) {
          if (b.is_error) {
            // Denied by pre_ask.py: answered by Haiku, or left to be re-asked in a later call.
            const auto = take(autos, q.question);
            if (auto) items.push({ kind: "auto_decision", q, record: auto, review: reviews.get(auto.id), ts: auto.ts });
            continue;
          }
          const rec = take(answers, q.question);
          const answer = rec?.answer ?? given?.[q.question];
          if (answer != null)
            items.push({
              kind: "user_decision",
              q,
              answer: String(answer),
              notes: rec?.notes ?? tur?.annotations?.[q.question]?.notes,
              record: rec,
              ts: rec?.ts ?? e.timestamp,
            });
        }
        continue;
      }
      const step = toolSteps.get(b.tool_use_id);
      if (step && step.type === "tool") {
        step.result = truncate(resultText(b.content));
        step.isError = !!b.is_error;
      }
    }
  }
  flush();

  // A question still on screen in the terminal.
  for (const ask of asks.values()) for (const q of ask.questions) items.push({ kind: "pending_decision", q, ts: ask.ts });

  // Records the transcript didn't place (e.g. transcript not synced yet).
  for (const r of autos)
    if (!used.has(r.id))
      items.push({
        kind: "auto_decision",
        q: { question: r.question ?? "", options: [] },
        record: r,
        review: reviews.get(r.id),
        ts: r.ts,
      });
  for (const r of answers)
    if (!used.has(r.id))
      items.push({
        kind: "user_decision",
        q: { question: r.question ?? "", header: r.header as string | undefined, options: r.options ?? [] },
        answer: String(r.answer ?? ""),
        notes: r.notes,
        record: r,
        ts: r.ts,
      });

  return { title, items };
}

/** Minimal line diff (LCS) for rendering Edit/Write. */
export function lineDiff(a: string, b: string): { op: " " | "-" | "+"; text: string }[] {
  const x = a ? a.split("\n") : [];
  const y = b ? b.split("\n") : [];
  if (x.length * y.length > 250_000) return [...x.map((t) => ({ op: "-" as const, text: t })), ...y.map((t) => ({ op: "+" as const, text: t }))];
  const n = x.length;
  const m = y.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { op: " " | "-" | "+"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ op: " ", text: x[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ op: "-", text: x[i++] });
    else out.push({ op: "+", text: y[j++] });
  }
  while (i < n) out.push({ op: "-", text: x[i++] });
  while (j < m) out.push({ op: "+", text: y[j++] });
  return out;
}
