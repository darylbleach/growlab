/**
 * Needs work (API `worst`) is the bottom 10 root posts by impressions.
 * Age filter applies to this list only — Top posts stay unfiltered.
 *
 * Fail-closed on missing/unparseable `created_at_x`: exclude the row.
 * We cannot tell if it is still in the quiet-distribution window, so it
 * must not appear as "needs work".
 */
export const WORST_MIN_AGE_SQL = `datetime('now', '-24 hours')`;

export const WORST_POSTS_SQL = `SELECT * FROM posts_cache
     WHERE account_id = ?
       AND is_reply = 0
       AND created_at_x IS NOT NULL
       AND TRIM(created_at_x) != ''
       AND datetime(REPLACE(REPLACE(created_at_x, 'T', ' '), 'Z', '')) <= ${WORST_MIN_AGE_SQL}
     ORDER BY impressions ASC, likes ASC
     LIMIT 10`;

const MS_24H = 24 * 60 * 60 * 1000;

/** Same fail-closed rule as WORST_POSTS_SQL, for tests. */
export function isEligibleForWorst(
  createdAtX: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (createdAtX == null) return false;
  const trimmed = createdAtX.trim();
  if (!trimmed) return false;
  const t = Date.parse(trimmed);
  if (Number.isNaN(t)) return false;
  return nowMs - t >= MS_24H;
}
