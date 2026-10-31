import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

// Pages and /api/review are public. Only the hook routes (ingest, reviews) need DASHBOARD_TOKEN.

function sha256(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

/** Hooks authenticate with `Authorization: Bearer <DASHBOARD_TOKEN>`. */
export function hasBearer(req: Request): boolean {
  const token = process.env.DASHBOARD_TOKEN;
  const h = req.headers.get("authorization") || "";
  if (!token || !h.startsWith("Bearer ")) return false;
  return timingSafeEqual(sha256(h.slice(7).trim()), sha256(token));
}

export function unauthorized() {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
