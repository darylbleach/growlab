import { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env } from "../env";
import { id, sha256Hex } from "./crypto";

const SESSION_COOKIE = "gl_session";
const DEFAULT_USER_ID = "user_main";

export async function ensureDefaultUser(db: D1Database) {
  await db
    .prepare(`INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)`)
    .bind(DEFAULT_USER_ID, "owner@growlab.local")
    .run();
}

export async function createSession(c: Context<{ Bindings: Env }>, userId = DEFAULT_USER_ID) {
  const sessionId = id("sess");
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`,
  )
    .bind(sessionId, userId, expires)
    .run();
  setCookie(c, SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  return sessionId;
}

export async function destroySession(c: Context<{ Bindings: Env }>) {
  const sid = getCookie(c, SESSION_COOKIE);
  if (sid) {
    await c.env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sid).run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export async function getSessionUserId(c: Context<{ Bindings: Env }>): Promise<string | null> {
  const sid = getCookie(c, SESSION_COOKIE);
  if (!sid) return null;
  const row = await c.env.DB.prepare(
    `SELECT user_id, expires_at FROM sessions WHERE id = ?`,
  )
    .bind(sid)
    .first<{ user_id: string; expires_at: string }>();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await c.env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sid).run();
    return null;
  }
  return row.user_id;
}

export async function requireAuth(c: Context<{ Bindings: Env }>): Promise<string | Response> {
  // API key bearer auth
  const auth = c.req.header("Authorization");
  if (auth?.startsWith("Bearer glk_")) {
    const raw = auth.slice("Bearer ".length);
    const hash = await sha256Hex(raw);
    const key = await c.env.DB.prepare(
      `SELECT user_id, id FROM api_keys WHERE key_hash = ?`,
    )
      .bind(hash)
      .first<{ user_id: string; id: string }>();
    if (key) {
      await c.env.DB.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`)
        .bind(key.id)
        .run();
      return key.user_id;
    }
  }

  const userId = await getSessionUserId(c);
  if (!userId) {
    return c.json({ error: { code: "unauthorized", message: "Login required" } }, 401);
  }
  return userId;
}

export { DEFAULT_USER_ID };
