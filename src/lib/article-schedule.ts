/** Persist datetimes in SQLite-comparable UTC so `scheduled_for <= datetime('now')` works. */
export function toSqliteUtc(value: string): string {
  const iso = value.includes("T") ? value : value.replace(" ", "T") + (value.endsWith("Z") ? "" : "Z");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid_datetime:${value}`);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export function normalizeScheduledFor(value: unknown): string | null {
  if (value === undefined) throw new Error("scheduled_for_missing");
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("invalid_datetime");
  const trimmed = value.trim();
  if (!trimmed) return null;
  return toSqliteUtc(trimmed);
}

/** When PATCH sets scheduled_for and omits status, flip draft ↔ scheduled. */
export function statusForSchedulePatch(scheduledFor: string | null, explicitStatus?: string): string | undefined {
  if (explicitStatus !== undefined) return undefined;
  return scheduledFor ? "scheduled" : "draft";
}

/** Map /api/media/... cover URLs to an R2 object key. Absolute non-media URLs return null. */
export function r2KeyFromCoverUrl(coverUrl: string): string | null {
  const marker = "/api/media/";
  const idx = coverUrl.indexOf(marker);
  if (idx < 0) return null;
  const key = decodeURIComponent(coverUrl.slice(idx + marker.length).split("?")[0] || "");
  if (!key || key.includes("..") || key.startsWith("/") || key.includes("\\") || key.includes("\0")) {
    throw new Error(`invalid_cover_key:${key || "(empty)"}`);
  }
  return key;
}
