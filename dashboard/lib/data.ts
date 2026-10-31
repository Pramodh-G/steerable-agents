import "server-only";
import { db } from "./db";
import { latestReviews, type StoreRecord, type TranscriptLine } from "./timeline";

export type SessionRow = {
  id: string;
  cwd: string | null;
  title: string | null;
  last_seen: string;
  you_decided: number;
  haiku_decided: number;
  needs_review: number;
};

export async function listSessions(): Promise<SessionRow[]> {
  const sql = await db();
  const rows = await sql`
    with titles as (
      select distinct on (session_id) session_id, entry->>'aiTitle' as title
      from transcript_lines where entry->>'type' = 'ai-title'
      order by session_id, line_no desc
    ),
    asked as (
      select session_id, sum((select count(*) from jsonb_object_keys(entry->'toolUseResult'->'answers'))) as n
      from transcript_lines
      where entry->>'type' = 'user' and jsonb_typeof(entry->'toolUseResult'->'answers') = 'object'
      group by session_id
    ),
    reviewed as (select distinct data->>'auto_answer_id' as id from records where kind = 'review'),
    autos as (
      select session_id, count(*) as n, count(*) filter (where id not in (select id from reviewed where id is not null)) as open
      from records where kind = 'auto_answer' group by session_id
    ),
    answers as (select session_id, count(*) as n from records where kind = 'answer' group by session_id)
    select s.id, s.cwd, t.title, s.last_seen,
      greatest(coalesce(asked.n, 0), coalesce(answers.n, 0))::int as you_decided,
      coalesce(autos.n, 0)::int as haiku_decided,
      coalesce(autos.open, 0)::int as needs_review
    from sessions s
    left join titles t on t.session_id = s.id
    left join asked on asked.session_id = s.id
    left join answers on answers.session_id = s.id
    left join autos on autos.session_id = s.id
    order by s.last_seen desc`;
  return rows as SessionRow[];
}

export async function getSession(id: string) {
  const sql = await db();
  const [session] = await sql`select id, cwd, first_seen, last_seen from sessions where id = ${id}`;
  if (!session) return null;
  const lines = (await sql`select line_no, entry from transcript_lines where session_id = ${id} order by line_no`) as TranscriptLine[];
  const records = (await sql`select data from records where session_id = ${id} order by ts`).map((r) => r.data as StoreRecord);
  const autoIds = records.filter((r) => r.kind === "auto_answer").map((r) => r.id);
  // Reviews and precedents may live under other sessions.
  const reviews = autoIds.length
    ? (await sql`select data from records where kind = 'review' and data->>'auto_answer_id' = any(${autoIds})`).map((r) => r.data as StoreRecord)
    : [];
  const precIds = [...new Set(records.flatMap((r) => (r.kind === "auto_answer" ? r.precedent_ids ?? [] : [])))];
  const precedents = precIds.length
    ? (await sql`select data from records where id = any(${precIds})`).map((r) => r.data as StoreRecord)
    : [];
  const seen = new Set(records.map((r) => r.id));
  return {
    session: session as { id: string; cwd: string | null; first_seen: string; last_seen: string },
    lines,
    records: [...records, ...reviews.filter((r) => !seen.has(r.id))],
    precedents: Object.fromEntries(precedents.map((p) => [p.id, p])) as Record<string, StoreRecord>,
  };
}

export type HaikuRow = { auto: StoreRecord; review?: StoreRecord; precedents: StoreRecord[] };

export async function haikuStats() {
  const sql = await db();
  const autos = (await sql`select data from records where kind = 'auto_answer' order by ts`).map((r) => r.data as StoreRecord);
  const reviews = latestReviews((await sql`select data from records where kind = 'review'`).map((r) => r.data as StoreRecord));
  const precIds = [...new Set(autos.flatMap((a) => a.precedent_ids ?? []))];
  const precMap = new Map(
    (precIds.length ? await sql`select data from records where id = any(${precIds})` : []).map((r) => [r.data.id as string, r.data as StoreRecord]),
  );
  const rows: HaikuRow[] = autos.map((auto) => ({
    auto,
    review: reviews.get(auto.id),
    precedents: (auto.precedent_ids ?? []).map((id) => precMap.get(id)).filter((p): p is StoreRecord => !!p),
  }));
  return rows;
}
