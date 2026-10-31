import { Suspense } from "react";
import AutoRefresh from "@/components/AutoRefresh";
import HaikuStats from "@/components/HaikuStats";

export default function HaikuPage() {
  return (
    <main className="page">
      <AutoRefresh ms={5000} />
      <h1>Haiku flywheel</h1>
      <p className="sub">Every accept or override labels a Haiku auto-answer right or wrong. Overrides sync back to the local store as corrections.</p>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <HaikuStats full />
      </Suspense>
    </main>
  );
}
