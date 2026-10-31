import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import AutoRefresh from "@/components/AutoRefresh";
import ReviewControls from "@/components/ReviewControls";
import { connection } from "next/server";
import { getSession } from "@/lib/data";
import { ago, shortCwd } from "@/lib/format";
import { buildTimeline, lineDiff, type Item, type Option, type Step, type StoreRecord } from "@/lib/timeline";

export default function SessionPage({ params }: PageProps<"/s/[id]">) {
  return (
    <main className="page">
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <SessionView params={params} />
      </Suspense>
    </main>
  );
}

async function SessionView({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const data = await getSession(id);
  if (!data) notFound();
  const { title, items } = buildTimeline(data.lines, data.records);
  const you = items.filter((i) => i.kind === "user_decision").length;
  const haiku = items.filter((i) => i.kind === "auto_decision").length;
  const open = items.filter((i) => i.kind === "auto_decision" && !i.review).length;

  return (
    <>
      <AutoRefresh />
      <h1>{title || id.slice(0, 8)}</h1>
      <p className="sub">
        <span className="mono">{shortCwd(data.session.cwd)}</span> · last activity {ago(data.session.last_seen)} · {you} decided by you · {haiku} by Haiku
        {open > 0 && <> · <span className="pill review">{open} to review</span></>}
      </p>
      <div className="timeline">
        {items.length === 0 && <p className="empty">Nothing synced yet.</p>}
        {items.map((it, i) => (
          <TimelineItem key={i} item={it} precedents={data.precedents} />
        ))}
      </div>
    </>
  );
}

function TimelineItem({ item, precedents }: { item: Item; precedents: Record<string, StoreRecord> }) {
  switch (item.kind) {
    case "prompt":
      return (
        <div className="prompt">
          <div className="who">You</div>
          {item.text}
        </div>
      );
    case "segment":
      return <Segment steps={item.steps} summary={item.summary} />;
    case "user_decision":
      return <UserDecision item={item} />;
    case "auto_decision":
      return <AutoDecision item={item} precedents={precedents} />;
    case "pending_decision":
      return (
        <div className="card pending">
          <span className="tag">Waiting for you</span>
          <span className="header">{item.q.header}</span>
          <h3>{item.q.question}</h3>
          <Options options={item.q.options} />
        </div>
      );
  }
}

function Options({ options, chosen }: { options: Option[]; chosen?: Set<string> }) {
  if (!options.length) return null;
  return (
    <ul className="opts">
      {options.map((o) => (
        <li key={o.label} className={chosen?.has(o.label) ? "chosen" : ""}>
          {o.label}
          {o.description && <span className="d">{o.description}</span>}
        </li>
      ))}
    </ul>
  );
}

function UserDecision({ item }: { item: Extract<Item, { kind: "user_decision" }> }) {
  const labels = new Set(item.q.options.map((o) => o.label));
  // Multi-select answers come back comma-joined.
  const parts = item.q.multiSelect ? item.answer.split(", ") : [item.answer];
  const chosen = new Set(parts.filter((p) => labels.has(p)));
  const free = parts.filter((p) => !labels.has(p)).join(", ");
  return (
    <div className="card" id={item.record ? `rec-${item.record.id}` : undefined}>
      <span className="tag">You decided</span>
      <span className="header">{item.q.header}</span>
      <h3>{item.q.question}</h3>
      <Options options={item.q.options} chosen={chosen} />
      {free && (
        <div className="free">
          <span className="lbl">Your answer</span>
          {free}
        </div>
      )}
      {item.notes && (
        <div className="kv">
          <span className="lbl">Notes</span>
          {item.notes}
        </div>
      )}
    </div>
  );
}

function AutoDecision({ item, precedents }: { item: Extract<Item, { kind: "auto_decision" }>; precedents: Record<string, StoreRecord> }) {
  const r = item.record;
  const answer = String(r.answer ?? "");
  const precs = (r.precedent_ids ?? []).map((id) => ({ id, rec: precedents[id] }));
  return (
    <div className="card haiku" id={`rec-${r.id}`}>
      <span className="tag">Haiku decided</span>
      <span className="header">{item.q.header}</span>
      <h3>{item.q.question}</h3>
      <div className="kv">
        <span className="lbl">Haiku&apos;s answer</span>
        <span className="answer-big">{answer}</span>
      </div>
      {r.reason && (
        <div className="kv">
          <span className="lbl">Why</span>
          {r.reason}
        </div>
      )}
      {precs.length > 0 && (
        <div className="kv">
          <span className="lbl">Precedent</span>
          {precs.map(({ id, rec }) =>
            rec ? (
              <div key={id}>
                <Link href={`/s/${rec.session_id}#rec-${id}`}>&ldquo;{rec.question}&rdquo;</Link> → {String(rec.answer ?? "")}{" "}
                <span className="muted">({ago(rec.ts)})</span>
              </div>
            ) : (
              <div key={id} className="muted mono">{id} (not synced)</div>
            ),
          )}
        </div>
      )}
      {item.review ? (
        <div className={`verdict ${item.review.verdict}`}>
          {item.review.verdict === "accept" ? "✓ You accepted this" : <>✗ You overrode this: {String(item.review.answer ?? "")}</>}
        </div>
      ) : (
        <ReviewControls autoId={r.id} haikuAnswer={answer} options={item.q.options} />
      )}
    </div>
  );
}

function Segment({ steps, summary }: { steps: Step[]; summary: string }) {
  const lastText = [...steps].reverse().find((s) => s.type === "text") as Extract<Step, { type: "text" }> | undefined;
  const snip = lastText?.text.split("\n").find((l) => l.trim())?.slice(0, 110);
  return (
    <details className="seg">
      <summary>
        {summary}
        {snip && <span className="snip"> — {snip}</span>}
      </summary>
      <div className="seg-body">
        {steps.map((s, i) => (
          <StepView key={i} step={s} />
        ))}
      </div>
    </details>
  );
}

function StepView({ step }: { step: Step }) {
  if (step.type === "thinking") return step.text ? <div className="step-think">{step.text}</div> : <div className="step-think">thinking…</div>;
  if (step.type === "text") return <div className="step-text">{step.text}</div>;
  if (step.type === "diff")
    return (
      <div className="diff mono">
        <div className="file">
          {step.tool} {shortCwd(step.file)}
        </div>
        {step.edits.map((e, i) => (
          <div key={i} className={i ? "sep" : ""}>
            {lineDiff(e.old, e.new).map((l, j) => (
              <div key={j} className={`ln ${l.op === "+" ? "add" : l.op === "-" ? "del" : ""}`}>
                {l.op} {l.text}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  return (
    <details className={`step-tool ${step.isError ? "error" : ""}`}>
      <summary>
        <span className="name">{step.name}</span> <span className="sum mono">{step.summary}</span>
      </summary>
      {step.result != null && <pre>{step.result || "(no output)"}</pre>}
    </details>
  );
}
