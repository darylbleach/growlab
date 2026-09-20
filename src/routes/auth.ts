import { Hono } from "hono";
import type { Env } from "../env";
import {
  createSession,
  destroySession,
  ensureDefaultUser,
  requireAuth,
  DEFAULT_USER_ID,
} from "../lib/auth";
import { id, sha256Hex } from "../lib/crypto";
import { aiConfigured } from "../lib/ai";
import { xConfigured } from "../lib/x";

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.get("/status", async (c) => {
  await ensureDefaultUser(c.env.DB);
  const user = await requireAuth(c);
  const loggedIn = typeof user === "string";
  return c.json({
    authenticated: loggedIn,
    x_configured: xConfigured(c.env),
    ai_configured: aiConfigured(c.env),
    app_name: c.env.APP_NAME || "GrowLab",
  });
});

authRoutes.post("/login", async (c) => {
  await ensureDefaultUser(c.env.DB);
  const body = await c.req.json<{ password?: string }>();
  if (!c.env.APP_PASSWORD) {
    return c.json({ error: { code: "misconfigured", message: "APP_PASSWORD not set" } }, 500);
  }
  if (!body.password || body.password !== c.env.APP_PASSWORD) {
    return c.json({ error: { code: "invalid_credentials", message: "Wrong password" } }, 401);
  }
  await createSession(c, DEFAULT_USER_ID);
  return c.json({ ok: true });
});

authRoutes.post("/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

authRoutes.post("/api-keys", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const body = await c.req.json<{ name?: string }>();
  const raw = `glk_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const keyId = id("key");
  await c.env.DB.prepare(
    `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(keyId, user, body.name || "default", await sha256Hex(raw), raw.slice(0, 12))
    .run();
  return c.json({ id: keyId, key: raw, warning: "Copy now; it will not be shown again." });
});

authRoutes.get("/api-keys", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const rows = await c.env.DB.prepare(
    `SELECT id, name, key_prefix, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`,
  )
    .bind(user)
    .all();
  return c.json({ data: rows.results || [] });
});
