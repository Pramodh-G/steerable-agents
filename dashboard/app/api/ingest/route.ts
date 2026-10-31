import { db, toJsonText } from "@/lib/db";
import { hasBearer, unauthorized } from "@/lib/auth";

type Body = {
  session: { id: string; cwd?: string | null };
  lines?: { n: number; entry: unknown }[];
  records?: { id: string; session_id?: string; kind?: string; source?: string; ts?: string }[];
};

/** Upserts a session, new transcript lines, and store records. Idempotent: retries never duplicate. */
export async function POST(req: Request) {
  if (!hasBearer(req)) return unauthorized();
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const sid = body?.session?.id;
  if (!sid || typeof sid !== "string") return Response.json({ error: "session.id required" }, { status: 400 });

  const sql = await db();
  const cwd = body.session.cwd ?? null;
  await sql`insert into sessions (id, cwd) values (${sid}, ${cwd})
    on conflict (id) do update set last_seen = now(), cwd = coalesce(excluded.cwd, sessions.cwd)`;

  const lines = (body.lines || []).filter((l) => Number.isInteger(l?.n));
  if (lines.length) {
    const nums = lines.map((l) => l.n);
    const entries = lines.map((l) => toJsonText(l.entry));
    await sql`insert into transcript_lines (session_id, line_no, entry)
      select ${sid}, n, e::jsonb from unnest(${nums}::int[], ${entries}::text[]) as t(n, e)
      on conflict do nothing`;
  }

  const records = (body.records || []).filter((r) => r && typeof r.id === "string");
  if (records.length) {
    await sql`insert into records (id, session_id, kind, source, ts, data)
      select id, sid, kind, source, ts::timestamptz, d::jsonb
      from unnest(${records.map((r) => r.id)}::text[], ${records.map((r) => r.session_id ?? sid)}::text[],
                  ${records.map((r) => r.kind ?? null)}::text[], ${records.map((r) => r.source ?? null)}::text[],
                  ${records.map((r) => r.ts ?? null)}::text[], ${records.map((r) => toJsonText(r))}::text[])
        as t(id, sid, kind, source, ts, d)
      on conflict (id) do nothing`;
  }
  return Response.json({ ok: true, lines: lines.length, records: records.length });
}
