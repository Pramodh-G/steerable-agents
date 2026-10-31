import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";

/** Accept or override a Haiku auto-answer. Stored as a `review` record (schema_version 1). Public: no auth. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const id = body?.auto_answer_id;
  const verdict = body?.verdict;
  const answer = typeof body?.answer === "string" ? body.answer.trim() : "";
  if (typeof id !== "string" || (verdict !== "accept" && verdict !== "override"))
    return Response.json({ error: "auto_answer_id and verdict required" }, { status: 400 });
  if (verdict === "override" && !answer) return Response.json({ error: "override needs an answer" }, { status: 400 });
  if (answer.length > 2000) return Response.json({ error: "answer too long" }, { status: 400 });

  const sql = await db();
  const [auto] = await sql`select data from records where id = ${id} and kind = 'auto_answer'`;
  if (!auto) return Response.json({ error: "no such auto_answer" }, { status: 404 });
  const a = auto.data as Record<string, unknown>;

  const record = {
    schema_version: 1,
    id: randomBytes(6).toString("hex"),
    kind: "review",
    source: "user",
    ts: new Date().toISOString(),
    session_id: a.session_id ?? null,
    cwd: a.cwd ?? null,
    auto_answer_id: id,
    verdict,
    question: a.question ?? null,
    haiku_answer: a.answer ?? null,
    answer: verdict === "override" ? answer : a.answer ?? null,
    precedent_ids: a.precedent_ids ?? [],
    via: "dashboard",
  };
  await sql`insert into records (id, session_id, kind, source, ts, data)
    values (${record.id}, ${record.session_id as string | null}, 'review', 'user', ${record.ts}::timestamptz, ${JSON.stringify(record)}::jsonb)`;
  return Response.json({ ok: true, review: record });
}
