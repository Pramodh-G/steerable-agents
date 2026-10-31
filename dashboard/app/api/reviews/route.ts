import { db } from "@/lib/db";
import { hasBearer, unauthorized } from "@/lib/auth";

/** Dashboard accepts/overrides made since `since`, for sync.py to append to the local store. */
export async function GET(req: Request) {
  if (!hasBearer(req)) return unauthorized();
  const since = new URL(req.url).searchParams.get("since") || "1970-01-01T00:00:00Z";
  const sql = await db();
  const rows = await sql`select data from records where kind = 'review' and ts >= ${since}::timestamptz order by ts`;
  return Response.json({ reviews: rows.map((r) => r.data) });
}
