import { Hono } from "hono";
import type { Env } from "../env";
import { requireAuth, DEFAULT_USER_ID } from "../lib/auth";
import { encryptText, id } from "../lib/crypto";
import { getMe, xConfigured } from "../lib/x";
import {
  authorizeUrl,
  oauth1AccessToken,
  oauth1Configured,
  oauth1RequestToken,
} from "../lib/oauth1";

export const oauthRoutes = new Hono<{ Bindings: Env }>();

oauthRoutes.get("/x/start", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  if (!oauth1Configured(c.env) && !xConfigured(c.env)) {
    return c.json(
      {
        error: {
          code: "x_not_configured",
          message: "X API keys not set on the Worker.",
        },
      },
      400,
    );
  }

  try {
    const callback = `${c.env.APP_URL}/oauth/x/callback`;
    const reqToken = await oauth1RequestToken(c.env, callback);
    const state = id("oauth");
    await c.env.KV.put(
      `oauth:${reqToken.oauth_token}`,
      JSON.stringify({
        tokenSecret: reqToken.oauth_token_secret,
        userId: user,
        state,
      }),
      { expirationTtl: 600 },
    );
    return c.redirect(authorizeUrl(reqToken.oauth_token));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json(
      {
        error: {
          code: "oauth_start_failed",
          message,
          hint: "In console.x.com → your app → User authentication: enable OAuth 1.0a, set callback to https://growlab.darylbleach.workers.dev/oauth/x/callback, permissions Read and write.",
        },
      },
      502,
    );
  }
});

oauthRoutes.get("/x/callback", async (c) => {
  const err = c.req.query("error") || c.req.query("denied");
  if (err) return c.html(`<h1>X OAuth error</h1><p>${err}</p><a href="/">Back</a>`);

  const oauthToken = c.req.query("oauth_token");
  const verifier = c.req.query("oauth_verifier");
  if (!oauthToken || !verifier) return c.text("Missing oauth_token/verifier", 400);

  const raw = await c.env.KV.get(`oauth:${oauthToken}`);
  if (!raw) return c.text("OAuth state expired — try Connect X again", 400);
  await c.env.KV.delete(`oauth:${oauthToken}`);
  const { tokenSecret, userId } = JSON.parse(raw) as {
    tokenSecret: string;
    userId: string;
  };

  const access = await oauth1AccessToken(c.env, oauthToken, tokenSecret, verifier);
  // For OAuth 1.0a we store access token + secret (secret in refresh_token_enc field)
  const accessEnc = await encryptText(c.env.TOKEN_ENCRYPTION_SECRET, access.oauth_token);
  const secretEnc = await encryptText(c.env.TOKEN_ENCRYPTION_SECRET, access.oauth_token_secret);

  let handle = access.screen_name;
  let displayName = access.screen_name;
  let xUserId = access.user_id;
  let avatarUrl: string | null = null;

  try {
    const me = await getMe(c.env, {
      mode: "oauth1",
      accessToken: access.oauth_token,
      tokenSecret: access.oauth_token_secret,
    });
    handle = me.username;
    displayName = me.name;
    xUserId = me.id;
    avatarUrl = me.profile_image_url || null;
  } catch {
    // Fall back to screen_name / user_id from access_token response
  }

  const existing = await c.env.DB.prepare(
    `SELECT id FROM x_accounts WHERE user_id = ? AND x_user_id = ?`,
  )
    .bind(userId || DEFAULT_USER_ID, xUserId)
    .first<{ id: string }>();

  const accountId = existing?.id || id("acc");
  await upsertAccount(c.env, {
    accountId,
    existing: Boolean(existing),
    userId: userId || DEFAULT_USER_ID,
    xUserId,
    handle,
    displayName,
    avatarUrl,
    accessEnc,
    secretEnc,
  });

  return c.redirect("/?connected=1");
});

async function upsertAccount(
  env: Env,
  opts: {
    accountId: string;
    existing: boolean;
    userId: string;
    xUserId: string;
    handle: string;
    displayName: string;
    avatarUrl: string | null;
    accessEnc: string;
    secretEnc: string;
  },
) {
  const mains = await env.DB.prepare(`SELECT COUNT(*) as c FROM x_accounts WHERE user_id = ?`)
    .bind(opts.userId)
    .first<{ c: number }>();
  const isMain = !mains?.c ? 1 : 0;

  if (opts.existing) {
    await env.DB.prepare(
      `UPDATE x_accounts SET handle = ?, display_name = ?, avatar_url = ?, access_token_enc = ?, refresh_token_enc = ?, token_expires_at = NULL, scopes = ?, updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(
        opts.handle,
        opts.displayName,
        opts.avatarUrl,
        opts.accessEnc,
        opts.secretEnc,
        "oauth1",
        opts.accountId,
      )
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO x_accounts (id, user_id, x_user_id, handle, display_name, avatar_url, access_token_enc, refresh_token_enc, token_expires_at, scopes, is_main)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'oauth1', ?)`,
    )
      .bind(
        opts.accountId,
        opts.userId,
        opts.xUserId,
        opts.handle,
        opts.displayName,
        opts.avatarUrl,
        opts.accessEnc,
        opts.secretEnc,
        isMain,
      )
      .run();
    await env.DB.prepare(`INSERT OR IGNORE INTO context_settings (account_id) VALUES (?)`)
      .bind(opts.accountId)
      .run();
    await env.DB.prepare(`INSERT OR IGNORE INTO queue_settings (account_id) VALUES (?)`)
      .bind(opts.accountId)
      .run();
  }
}

export const accountRoutes = new Hono<{ Bindings: Env }>();

accountRoutes.get("/", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const rows = await c.env.DB.prepare(
    `SELECT id, handle, display_name, avatar_url, is_main, timezone, created_at FROM x_accounts WHERE user_id = ? ORDER BY is_main DESC, created_at ASC`,
  )
    .bind(user)
    .all();
  return c.json({
    data: rows.results || [],
    x_configured: oauth1Configured(c.env) || xConfigured(c.env),
  });
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
