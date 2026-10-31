import Link from "next/link";
import { connection } from "next/server";
import { haikuStats, type HaikuRow } from "@/lib/data";
import { ago, shortCwd } from "@/lib/format";

function day(ts: unknown): string {
  const d = new Date(String(ts ?? ""));
  return isNaN(d.getTime()) ? "unknown" : d.toISOString().slice(0, 10);
}

export default async function HaikuStats({ full = false }: { full?: boolean }) {
  await connection();
  const rows = await haikuStats();
  const accepted = rows.filter((r) => r.review?.verdict === "accept").length;
  const overridden = rows.filter((r) => r.review?.verdict === "override").length;
  const open = rows.length - accepted - overridden;
  const reviewed = accepted + overridden;
  const accuracy = reviewed ? Math.round((accepted / reviewed) * 100) : null;

  const byDay = new Map<string, { accepted: number; overridden: number; open: number }>();
  for (const r of rows) {
    const k = day(r.auto.ts);
    const b = byDay.get(k) ?? { accepted: 0, overridden: 0, open: 0 };
    if (r.review?.verdict === "accept") b.accepted++;
    else if (r.review?.verdict === "override") b.overridden++;
    else b.open++;
    byDay.set(k, b);
  }
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-30);
  const max = Math.max(1, ...days.map(([, b]) => b.accepted + b.overridden + b.open));
  const overrides = rows.filter((r) => r.review?.verdict === "override").reverse();

  return (
    <>
      <div className="tiles">
        <div className="tile">
          <div className="k">Accuracy</div>
          <div className="v">{accuracy == null ? "—" : `${accuracy}%`}</div>
          <div className="s">of {reviewed} reviewed</div>
        </div>
        <div className="tile">
          <div className="k">Accepted</div>
          <div className="v">{accepted}</div>
          <div className="s">Haiku was right</div>
        </div>
        <div className="tile">
          <div className="k">Overridden</div>
          <div className="v">{overridden}</div>
          <div className="s">Haiku was wrong</div>
        </div>
        <div className="tile">
          <div className="k">Unreviewed</div>
          <div className="v">{open}</div>
          <div className="s">of {rows.length} auto-answers</div>
        </div>
      </div>

      <section className="panel">
        <h2>Auto-answers per day</h2>
        <div className="legend">
          <span><i style={{ background: "var(--series-1)" }} />Accepted</span>
          <span><i style={{ background: "var(--series-2)" }} />Overridden</span>
          <span><i style={{ background: "var(--series-none)" }} />Unreviewed</span>
        </div>
        {days.length === 0 ? (
          <p className="muted">No auto-answers yet.</p>
        ) : (
          <>
            <div className="bars" role="img" aria-label="Haiku auto-answers per day by review verdict">
              {days.map(([d, b]) => {
                const total = b.accepted + b.overridden + b.open;
                const acc = b.accepted + b.overridden ? Math.round((b.accepted / (b.accepted + b.overridden)) * 100) : null;
                return (
                  <div className="bar" key={d}>
                    <div className="tip">
                      {d}: {total} auto-answers · {b.accepted} accepted · {b.overridden} overridden · {b.open} unreviewed
                      {acc != null && ` · ${acc}% accurate`}
                    </div>
                    {(["accepted", "overridden", "open"] as const).map((k) =>
                      b[k] ? (
                        <div
                          key={k}
                          className="seg"
                          style={{
                            height: `${(b[k] / max) * 100}%`,
                            background: k === "accepted" ? "var(--series-1)" : k === "overridden" ? "var(--series-2)" : "var(--series-none)",
                          }}
                        />
                      ) : null,
                    )}
                  </div>
                );
              })}
            </div>
            <div className="xlabels">
              {days.map(([d]) => (
                <span key={d}>{d.slice(5)}</span>
              ))}
            </div>
          </>
        )}
      </section>

      {full && <section className="panel">
        <h2>Where Haiku went wrong</h2>
        <p className="muted" style={{ marginBottom: 8 }}>Overrides, newest first.</p>
        {overrides.length === 0 ? <p className="muted">No overrides yet.</p> : overrides.map((r) => <Override key={r.auto.id} row={r} />)}
      </section>}
    </>
  );
}

function Override({ row }: { row: HaikuRow }) {
  const { auto, review, precedents } = row;
  return (
    <div className="ovr">
      <div className="q">
        <Link href={`/s/${auto.session_id}#rec-${auto.id}`}>{auto.question}</Link>{" "}
        <span className="muted mono">{shortCwd(auto.cwd)} · {ago(review?.ts)}</span>
      </div>
      <div className="grid">
        <div>
          <span className="lbl muted">Haiku said</span>
          <div className="haiku-a">{String(auto.answer ?? "")}</div>
          {auto.reason && <div className="muted">{auto.reason}</div>}
        </div>
        <div>
          <span className="lbl muted">You said</span>
          <div className="user-a">{String(review?.answer ?? "")}</div>
        </div>
      </div>
      {precedents.length > 0 && (
        <div className="muted" style={{ marginTop: 6 }}>
          Leaned on:{" "}
          {precedents.map((p, i) => (
            <span key={p.id}>
              {i > 0 && "; "}
              <Link href={`/s/${p.session_id}#rec-${p.id}`}>&ldquo;{p.question}&rdquo;</Link> → {String(p.answer ?? "")}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
