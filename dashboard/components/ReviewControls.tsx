"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Option } from "@/lib/timeline";

const OTHER = "__other__";

export default function ReviewControls({ autoId, haikuAnswer, options }: { autoId: string; haikuAnswer: string; options: Option[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "override">("idle");
  const alternatives = options.filter((o) => o.label !== haikuAnswer);
  const [pick, setPick] = useState(alternatives[0]?.label ?? OTHER);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function send(verdict: "accept" | "override") {
    const answer = verdict === "override" ? (pick === OTHER ? text.trim() : pick) : undefined;
    if (verdict === "override" && !answer) return setErr("Pick an option or write your answer.");
    setBusy(true);
    setErr("");
    const res = await fetch("/api/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auto_answer_id: autoId, verdict, answer }),
    });
    setBusy(false);
    if (!res.ok) return setErr((await res.json().catch(() => ({}))).error || "Failed");
    setMode("idle");
    router.refresh();
  }

  if (mode === "override")
    return (
      <div className="override-box">
        {alternatives.map((o) => (
          <label key={o.label}>
            <input type="radio" name={`o-${autoId}`} checked={pick === o.label} onChange={() => setPick(o.label)} />
            <span>
              {o.label}
              {o.description && <span className="muted"> — {o.description}</span>}
            </span>
          </label>
        ))}
        <label>
          <input type="radio" name={`o-${autoId}`} checked={pick === OTHER} onChange={() => setPick(OTHER)} />
          <span>Other</span>
        </label>
        {pick === OTHER && <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Your answer" autoFocus />}
        <div className="review-row">
          <button className="primary" disabled={busy} onClick={() => send("override")}>Save override</button>
          <button disabled={busy} onClick={() => setMode("idle")}>Cancel</button>
        </div>
        {err && <div className="err">{err}</div>}
      </div>
    );

  return (
    <>
      <div className="review-row">
        <button className="primary" disabled={busy} onClick={() => send("accept")}>Accept</button>
        <button disabled={busy} onClick={() => setMode("override")}>Override</button>
      </div>
      {err && <div className="err">{err}</div>}
    </>
  );
}
