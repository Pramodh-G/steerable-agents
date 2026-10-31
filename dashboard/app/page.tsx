import Link from "next/link";
import { Suspense } from "react";
import AutoRefresh from "@/components/AutoRefresh";
import HaikuStats from "@/components/HaikuStats";
import { connection } from "next/server";
import { listSessions } from "@/lib/data";
import { ago, shortCwd } from "@/lib/format";

export default function Home() {
  return (
    <main className="page">
      <AutoRefresh ms={5000} />
      <h1>Haiku flywheel</h1>
      <p className="sub">
        How often Haiku answered for you, and how often it was right.
      </p>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <HaikuStats />
      </Suspense>
      <h1>Sessions</h1>
      <p className="sub">Every agent running the plugin, newest first.</p>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Sessions />
      </Suspense>
    </main>
  );
}

async function Sessions() {
  await connection();
  const sessions = await listSessions();
  if (!sessions.length)
    return <p className="empty">No sessions yet. Set <code>STEERABLE_SYNC_URL</code> and <code>STEERABLE_SYNC_TOKEN</code> and run Claude Code with the plugin.</p>;
  return (
    <>
      <table className="list">
        <thead>
          <tr>
            <th>Session</th>
            <th>Last activity</th>
            <th className="num">You decided</th>
            <th className="num">Haiku decided</th>
            <th className="num">Needs review</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id}>
              <td className="title-cell">
                <Link href={`/s/${s.id}`} className="t">{s.title || s.id.slice(0, 8)}</Link>
                <div className="c mono">{shortCwd(s.cwd)}</div>
              </td>
              <td className="muted">{ago(s.last_seen)}</td>
              <td className="num">{s.you_decided}</td>
              <td className="num">{s.haiku_decided}</td>
              <td className="num">{s.needs_review ? <span className="pill review">{s.needs_review}</span> : <span className="muted">0</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
