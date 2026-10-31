export function ago(ts: string | Date | undefined | null): string {
  if (!ts) return "";
  const d = typeof ts === "string" ? new Date(ts) : ts;
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function shortCwd(cwd: string | null | undefined): string {
  if (!cwd) return "";
  return cwd.replace(/^\/home\/[^/]+|^\/Users\/[^/]+/, "~");
}
