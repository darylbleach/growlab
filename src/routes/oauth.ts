import { Hono } from "hono";
import type { Env } from "../env";
import { requireAuth, DEFAULT_USER_ID } from "../lib/auth";
import { encryptText, id, pkceChallenge, pkceVerifier } from "../lib/crypto";
import {
  buildAuthUrl,
  exchangeCode,
  getMe,
  X_SCOPES,
  xConfigured,
} from "../lib/x";

export const oauthRoutes = new Hono<{ Bindings: Env }>();

oauthRoutes.get("/x/start", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  if (!xConfigured(c.env)) {
    return c.json(
      {
        error: {
          code: "x_not_configured",
          message: "X OAuth 2.0 Client ID/Secret not set on the Worker.",
        },
      },
      400,
    );
  }

  try {
    const state = id("oauth");
    const verifier = pkceVerifier();
    const challenge = await pkceChallenge(verifier);
    await c.env.KV.put(
      `oauth2:${state}`,
      JSON.stringify({ codeVerifier: verifier, userId: user }),
      { expirationTtl: 600 },
    );
    return c.redirect(buildAuthUrl(c.env, state, challenge));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json(
      {
        error: {
          code: "oauth_start_failed",
          message,
          hint: "In console.x.com → your app → User authentication settings → Set up (must not stay on Set up). App permissions: Read and write and Direct message. Type of App: Web App, Automated App or Bot (confidential). Callback URI: https://growlab.darylbleach.workers.dev/oauth/x/callback. Website URL: https://growlab.darylbleach.workers.dev. Then use OAuth 2.0 Client ID/Secret (not API Key/Secret).",
        },
      },
      502,
    );
  }
});

oauthRoutes.get("/x/callback", async (c) => {
  const err = c.req.query("error") || c.req.query("denied");
  if (err) {
    const desc = c.req.query("error_description") || err;
    return c.html(`<h1>X OAuth error</h1><p>${desc}</p><a href="/">Back</a>`);
  }

  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) return c.text("Missing code/state — try Connect X again", 400);

  const raw = await c.env.KV.get(`oauth2:${state}`);
  if (!raw) return c.text("OAuth state expired — try Connect X again", 400);
  await c.env.KV.delete(`oauth2:${state}`);
  const { codeVerifier, userId } = JSON.parse(raw) as {
    codeVerifier: string;
    userId: string;
  };

  try {
    const tokens = await exchangeCode(c.env, code, codeVerifier);
    const accessEnc = await encryptText(c.env.TOKEN_ENCRYPTION_SECRET, tokens.access_token);
    const refreshEnc = tokens.refresh_token
      ? await encryptText(c.env.TOKEN_ENCRYPTION_SECRET, tokens.refresh_token)
      : null;
    const expiresAt = new Date(Date.now() + (tokens.expires_in || 7200) * 1000).toISOString();

    const me = await getMe(c.env, { mode: "oauth2", accessToken: tokens.access_token });

    const existing = await c.env.DB.prepare(
      `SELECT id FROM x_accounts WHERE user_id = ? AND x_user_id = ?`,
    )
      .bind(userId || DEFAULT_USER_ID, me.id)
      .first<{ id: string }>();

    // Replace local stub if present so Connect X becomes main
    const stub = await c.env.DB.prepare(
      `SELECT id FROM x_accounts WHERE user_id = ? AND x_user_id = 'local' LIMIT 1`,
    )
      .bind(userId || DEFAULT_USER_ID)
      .first<{ id: string }>();

    const accountId = existing?.id || stub?.id || id("acc");
    const isExisting = Boolean(existing || stub);

    await upsertAccount(c.env, {
      accountId,
      existing: isExisting,
      userId: userId || DEFAULT_USER_ID,
      xUserId: me.id,
      handle: me.username,
      displayName: me.name,
      avatarUrl: me.profile_image_url || null,
      accessEnc,
      refreshEnc,
      expiresAt,
      scopes: tokens.scope || X_SCOPES,
    });

    return c.redirect("/?connected=1");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.html(
      `<h1>X connect failed</h1><pre>${message}</pre><p>Confirm User authentication is Set up with callback <code>https://growlab.darylbleach.workers.dev/oauth/x/callback</code>.</p><a href="/">Back</a>`,
    );
  }
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
    refreshEnc: string | null;
    expiresAt: string;
    scopes: string;
  },
) {
  const mains = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM x_accounts WHERE user_id = ? AND x_user_id != 'local'`,
  )
    .bind(opts.userId)
    .first<{ c: number }>();
  const isMain = !mains?.c ? 1 : 0;

  if (opts.existing) {
    await env.DB.prepare(
      `UPDATE x_accounts SET x_user_id = ?, handle = ?, display_name = ?, avatar_url = ?, access_token_enc = ?, refresh_token_enc = ?, token_expires_at = ?, scopes = ?, is_main = ?, updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(
        opts.xUserId,
        opts.handle,
        opts.displayName,
        opts.avatarUrl,
        opts.accessEnc,
        opts.refreshEnc,
        opts.expiresAt,
        opts.scopes,
        isMain,
        opts.accountId,
      )
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO x_accounts (id, user_id, x_user_id, handle, display_name, avatar_url, access_token_enc, refresh_token_enc, token_expires_at, scopes, is_main)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        opts.accountId,
        opts.userId,
        opts.xUserId,
        opts.handle,
        opts.displayName,
        opts.avatarUrl,
        opts.accessEnc,
        opts.refreshEnc,
        opts.expiresAt,
        opts.scopes,
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
    x_configured: xConfigured(c.env),
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
