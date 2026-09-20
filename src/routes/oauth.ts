import { Hono } from "hono";
import type { Env } from "../env";
import { requireAuth, DEFAULT_USER_ID } from "../lib/auth";
import { encryptText, id } from "../lib/crypto";
import {
  buildAuthUrl,
  exchangeCode,
  getMe,
  xConfigured,
} from "../lib/x";

function b64url(buf: ArrayBuffer | Uint8Array) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const oauthRoutes = new Hono<{ Bindings: Env }>();

oauthRoutes.get("/x/start", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  if (!xConfigured(c.env)) {
    return c.json(
      {
        error: {
          code: "x_not_configured",
          message: "Set X_CLIENT_ID and X_CLIENT_SECRET secrets, then retry.",
        },
      },
      400,
    );
  }

  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = b64url(verifierBytes);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = id("oauth");
  await c.env.KV.put(
    `oauth:${state}`,
    JSON.stringify({ verifier, userId: user }),
    { expirationTtl: 600 },
  );
  return c.redirect(buildAuthUrl(c.env, state, challenge));
});

oauthRoutes.get("/x/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const err = c.req.query("error");
  if (err) return c.html(`<h1>X OAuth error</h1><p>${err}</p><a href="/">Back</a>`);
  if (!code || !state) return c.text("Missing code/state", 400);

  const raw = await c.env.KV.get(`oauth:${state}`);
  if (!raw) return c.text("OAuth state expired", 400);
  await c.env.KV.delete(`oauth:${state}`);
  const { verifier, userId } = JSON.parse(raw) as { verifier: string; userId: string };

  const tokens = await exchangeCode(c.env, code, verifier);
  const me = await getMe(c.env, tokens.access_token);
  const accessEnc = await encryptText(c.env.TOKEN_ENCRYPTION_SECRET, tokens.access_token);
  const refreshEnc = tokens.refresh_token
    ? await encryptText(c.env.TOKEN_ENCRYPTION_SECRET, tokens.refresh_token)
    : null;
  const expires = new Date(Date.now() + (tokens.expires_in || 7200) * 1000).toISOString();

  const existing = await c.env.DB.prepare(
    `SELECT id FROM x_accounts WHERE user_id = ? AND x_user_id = ?`,
  )
    .bind(userId || DEFAULT_USER_ID, me.id)
    .first<{ id: string }>();

  const accountId = existing?.id || id("acc");
  const mains = await c.env.DB.prepare(
    `SELECT COUNT(*) as c FROM x_accounts WHERE user_id = ?`,
  )
    .bind(userId || DEFAULT_USER_ID)
    .first<{ c: number }>();
  const isMain = !mains?.c ? 1 : existing ? undefined : 0;

  if (existing) {
    await c.env.DB.prepare(
      `UPDATE x_accounts SET handle = ?, display_name = ?, avatar_url = ?, access_token_enc = ?, refresh_token_enc = ?, token_expires_at = ?, scopes = ?, updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(
        me.username,
        me.name,
        me.profile_image_url || null,
        accessEnc,
        refreshEnc,
        expires,
        tokens.scope || null,
        accountId,
      )
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO x_accounts (id, user_id, x_user_id, handle, display_name, avatar_url, access_token_enc, refresh_token_enc, token_expires_at, scopes, is_main)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        accountId,
        userId || DEFAULT_USER_ID,
        me.id,
        me.username,
        me.name,
        me.profile_image_url || null,
        accessEnc,
        refreshEnc,
        expires,
        tokens.scope || null,
        isMain ?? 0,
      )
      .run();
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO context_settings (account_id) VALUES (?)`,
    )
      .bind(accountId)
      .run();
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO queue_settings (account_id) VALUES (?)`,
    )
      .bind(accountId)
      .run();
  }

  return c.redirect("/?connected=1");
});

export const accountRoutes = new Hono<{ Bindings: Env }>();

accountRoutes.get("/", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const rows = await c.env.DB.prepare(
    `SELECT id, handle, display_name, avatar_url, is_main, timezone, created_at FROM x_accounts WHERE user_id = ? ORDER BY is_main DESC, created_at ASC`,
  )
    .bind(user)
    .all();
  return c.json({ data: rows.results || [], x_configured: xConfigured(c.env) });
});

accountRoutes.post("/:id/main", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const idParam = c.req.param("id");
  await c.env.DB.prepare(`UPDATE x_accounts SET is_main = 0 WHERE user_id = ?`).bind(user).run();
  await c.env.DB.prepare(`UPDATE x_accounts SET is_main = 1 WHERE id = ? AND user_id = ?`)
    .bind(idParam, user)
    .run();
  return c.json({ ok: true });
});

accountRoutes.delete("/:id", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  await c.env.DB.prepare(`DELETE FROM x_accounts WHERE id = ? AND user_id = ?`)
    .bind(c.req.param("id"), user)
    .run();
  return c.json({ ok: true });
});
