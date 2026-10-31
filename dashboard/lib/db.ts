import "server-only";
import { neon, neonConfig, type NeonQueryFunction } from "@neondatabase/serverless";

let client: NeonQueryFunction<false, false> | null = null;
let schemaReady: Promise<unknown> | null = null;

function sql() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    // Local testing only: point the HTTP driver at a Neon-compatible shim.
    if (process.env.NEON_FETCH_ENDPOINT) neonConfig.fetchEndpoint = process.env.NEON_FETCH_ENDPOINT;
    client = neon(url);
  }
  return client;
}

/** Creates the tables on first use (tables from dashboard.md). */
function ensureSchema() {
  if (!schemaReady) {
    const q = sql();
    schemaReady = (async () => {
      await q`create table if not exists sessions (
        id text primary key, cwd text, first_seen timestamptz default now(), last_seen timestamptz default now())`;
      await q`create table if not exists transcript_lines (
        session_id text, line_no int, entry jsonb, primary key (session_id, line_no))`;
      await q`create table if not exists records (
        id text primary key, session_id text, kind text, source text, ts timestamptz, data jsonb)`;
      await q`create index if not exists records_session on records (session_id)`;
      await q`create index if not exists records_kind_ts on records (kind, ts)`;
    })().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

/** The Neon tagged-template query function, after the schema exists. */
export async function db() {
  await ensureSchema();
  return sql();
}

/** Postgres jsonb rejects \u0000, which shows up in raw tool output. */
export function toJsonText(value: unknown): string {
  return JSON.stringify(value).replace(/(?<!\\)\\u0000/g, "");
}
