import { Hono, type Context } from "hono";
import type { Env } from "../env";
import { requireAuth, DEFAULT_USER_ID } from "../lib/auth";
import { encryptText, id, pkceChallenge, pkceVerifier } from "../lib/crypto";
import {
  authorizeUrl as oauth1AuthorizeUrl,
  oauth1AccessToken,
  oauth1Configured,
  oauth1RequestToken,
} from "../lib/oauth1";
import {
  buildAuthUrl,
  exchangeCode,
  getMe,
  probeTokenExchange,
  secretFingerprint,
  X_SCOPES,
  xClientId,
  xClientSecret,
  xConfigured,
  xFetch,
} from "../lib/x";

export const oauthRoutes = new Hono<{ Bindings: Env }>();

/** Auth-gated probe: distinguish invalid_client vs invalid_grant without exposing secrets. */
oauthRoutes.get("/x/probe", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  if (!xConfigured(c.env)) {
    return c.json({ ok: false, error: "x_not_configured" }, 400);
  }

  const clientIdRaw = c.env.X_CLIENT_ID || "";
  const clientSecretRaw = c.env.X_CLIENT_SECRET || "";
  const clientId = xClientId(c.env);
  const clientSecret = xClientSecret(c.env);
  const apiKey = (c.env.X_API_KEY || "").trim();
  const apiSecret = (c.env.X_API_SECRET || "").trim();

  let clientIdDecoded: string | null = null;
  try {
    // Client IDs are base64 without padding; pad for atob.
    const pad = "=".repeat((4 - (clientId.length % 4)) % 4);
    clientIdDecoded = atob(clientId + pad);
  } catch {
    clientIdDecoded = null;
  }

  const redirectUri = `${c.env.APP_URL}/oauth/x/callback`;
  const challenge = await pkceChallenge(pkceVerifier());
  const authorizeUrl = buildAuthUrl(c.env, "probe_state", challenge);

  const tokenHosts = [
    "https://api.x.com/2/oauth2/token",
    "https://api.twitter.com/2/oauth2/token",
  ];
  const styles = [
    "basic_raw",
    "basic_rfc_urlencoded",
    "basic_no_body_client_id",
    "body_only",
    "basic_mutated_secret",
    "basic_with_api_secret",
  ] as const;

  const trials = [];
  for (const tokenUrl of tokenHosts) {
    for (const style of styles) {
      // Only run api-secret / mutated variants on api.x.com to limit noise.
      if (tokenUrl.includes("twitter.com") && (style === "basic_mutated_secret" || style === "basic_with_api_secret")) {
        continue;
      }
      trials.push(
        await probeTokenExchange({
          tokenUrl,
          clientId,
          clientSecret,
          redirectUri,
          style,
          apiSecret,
        }),
      );
    }
  }

  const primary = trials.find((t) => t.host === "api.x.com" && t.style === "basic_raw") || trials[0];
  const credentialsOk = Boolean(primary?.credentials_ok);

  // OAuth 1.0a consumer probe (request_token) — proves API Key/Secret work independently.
  let oauth1Probe: {
    configured: boolean;
    ok: boolean;
    status?: number;
    error?: string | null;
  } = { configured: oauth1Configured(c.env), ok: false };
  if (apiKey && apiSecret) {
    try {
      await oauth1RequestToken(c.env, redirectUri);
      oauth1Probe = { configured: true, ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const statusMatch = msg.match(/request_token failed: (\d+)/);
      oauth1Probe = {
        configured: true,
        ok: false,
        status: statusMatch ? Number(statusMatch[1]) : undefined,
        error: msg.replace(/oauth_token_secret=[^&\s]+/g, "oauth_token_secret=…").slice(0, 240),
      };
    }
  }

  // Did mutating the secret change the error? If identical → X may not be validating secret, or always returns this.
  const mutated = trials.find((t) => t.style === "basic_mutated_secret");
  const secret_error_differs_when_mutated = Boolean(
    mutated && primary && (mutated.error !== primary.error || mutated.error_description !== primary.error_description),
  );

  return c.json({
    ok: true,
    credentials_ok: credentialsOk,
    token_http_status: primary?.status ?? null,
    token_error: primary?.error ?? null,
    token_error_description: primary?.error_description ?? null,
    secret_error_differs_when_mutated,
    client_id_prefix: clientId.slice(0, 8),
    client_id_suffix: clientId.slice(-6),
    client_id_len: clientId.length,
    client_id_raw_len: clientIdRaw.length,
    client_id_trim_changed: clientIdRaw !== clientId,
    client_secret_len: clientSecret.length,
    client_secret_raw_len: clientSecretRaw.length,
    client_secret_trim_changed: clientSecretRaw !== clientSecret,
    client_id_decoded_suffix: clientIdDecoded ? clientIdDecoded.slice(-8) : null,
    client_id_kind: clientIdDecoded?.endsWith(":ci")
      ? "confidential"
      : clientIdDecoded?.endsWith(":na")
        ? "public_native"
        : "unknown",
    client_id_fingerprint: secretFingerprint(clientId),
    client_secret_fingerprint: secretFingerprint(clientSecret),
    api_key_len: apiKey.length || null,
    api_secret_len: apiSecret.length || null,
    client_secret_equals_api_secret: Boolean(apiSecret) && clientSecret === apiSecret,
    client_id_equals_api_key: Boolean(apiKey) && clientId === apiKey,
    redirect_uri: redirectUri,
    authorize_host: new URL(authorizeUrl).host,
    authorize_scope_encoding: authorizeUrl.includes("scope=tweet.read%20")
      ? "percent20"
      : authorizeUrl.includes("scope=tweet.read+")
        ? "plus"
        : "other",
    authorize_url_preview: authorizeUrl.replace(/code_challenge=[^&]+/, "code_challenge=…"),
    oauth1_probe: oauth1Probe,
    trials,
  });
});

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

/** OAuth 1.0a 3-legged Connect. Primary dashboard Connect X path. */
oauthRoutes.get("/x/start-oauth1", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  if (!c.env.X_API_KEY || !c.env.X_API_SECRET) {
    return c.json(
      {
        error: {
          code: "oauth1_not_configured",
          message: "Set Worker secrets X_API_KEY and X_API_SECRET (OAuth 1.0a Consumer Key/Secret).",
        },
      },
      400,
    );
  }

  try {
    const callbackUrl = `${c.env.APP_URL.replace(/\/$/, "")}/oauth/x/callback`;
    const req = await oauth1RequestToken(c.env, callbackUrl);
    await c.env.KV.put(
      `oauth1:${req.oauth_token}`,
      JSON.stringify({ tokenSecret: req.oauth_token_secret, userId: user }),
      { expirationTtl: 600 },
    );
    return c.redirect(oauth1AuthorizeUrl(req.oauth_token));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json(
      {
        error: {
          code: "oauth1_start_failed",
          message: redactOauth(message),
          hint: "Confirm User authentication is saved, and X_API_KEY/X_API_SECRET are the OAuth 1.0a Consumer Key/Secret from Keys and tokens (not Client ID/Secret). Callback URL: https://growlab.darylbleach.workers.dev/oauth/x/callback",
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

  // OAuth 1.0a returns oauth_token + oauth_verifier (no code).
  const oauthToken = c.req.query("oauth_token");
  const oauthVerifier = c.req.query("oauth_verifier");
  if (oauthToken && oauthVerifier) {
    return handleOauth1Callback(c, oauthToken, oauthVerifier);
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
      `<h1>X connect failed</h1><pre>${message}</pre><p>Confirm User authentication is Set up with callback <code>https://growlab.darylbleach.workers.dev/oauth/x/callback</code>. If OAuth 2.0 keeps returning invalid_client, try <a href="/oauth/x/start-oauth1">Connect via OAuth 1.0a</a>.</p><a href="/">Back</a>`,
    );
  }
});

async function handleOauth1Callback(
  c: Context<{ Bindings: Env }>,
  oauthToken: string,
  oauthVerifier: string,
) {
  const raw = await c.env.KV.get(`oauth1:${oauthToken}`);
  if (!raw) return c.text("OAuth 1.0a state expired — try Connect again", 400);
  await c.env.KV.delete(`oauth1:${oauthToken}`);
  const { tokenSecret, userId } = JSON.parse(raw) as { tokenSecret: string; userId: string };

  try {
    const access = await oauth1AccessToken(c.env, oauthToken, tokenSecret, oauthVerifier);
    const accessEnc = await encryptText(c.env.TOKEN_ENCRYPTION_SECRET, access.oauth_token);
    const refreshEnc = await encryptText(c.env.TOKEN_ENCRYPTION_SECRET, access.oauth_token_secret);
    const profile = await oauth1Profile(c.env, access.oauth_token, access.oauth_token_secret);
    const xUserId = profile?.id || access.user_id;
    const handle = profile?.username || access.screen_name;

    const existing = await c.env.DB.prepare(
      `SELECT id FROM x_accounts WHERE user_id = ? AND x_user_id = ?`,
    )
      .bind(userId || DEFAULT_USER_ID, xUserId)
      .first<{ id: string }>();

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
      xUserId,
      handle,
      displayName: profile?.name || access.screen_name,
      avatarUrl: profile?.profile_image_url || null,
      accessEnc,
      refreshEnc,
      expiresAt: new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000).toISOString(),
      scopes: "oauth1 tweet.read tweet.write users.read dm.read dm.write",
    });

    const appUrl = (c.env.APP_URL || "").replace(/\/$/, "");
    return c.redirect(appUrl ? `${appUrl}/?connected=1&via=oauth1` : "/?connected=1&via=oauth1");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.html(
      `<h1>X OAuth 1.0a connect failed</h1><pre>${escapeHtml(redactOauth(message))}</pre><a href="/">Back</a>`,
      502,
    );
  }
}

async function oauth1Profile(
  env: Env,
  accessToken: string,
  tokenSecret: string,
): Promise<{ id: string; username: string; name: string; profile_image_url?: string } | null> {
  const auth = { mode: "oauth1" as const, accessToken, tokenSecret };
  try {
    return await getMe(env, auth);
  } catch {
    try {
      const res = await xFetch(
        env,
        auth,
        "https://api.twitter.com/2/users/me?user.fields=profile_image_url",
      );
      if (!res.ok) return null;
      const json = (await res.json()) as {
        data?: { id: string; username: string; name: string; profile_image_url?: string };
      };
      return json.data ?? null;
    } catch {
      return null;
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function redactOauth(message: string): string {
  return message
    .replace(/oauth_token_secret=[^&\s]+/gi, "oauth_token_secret=…")
    .replace(/oauth_token=[^&\s]+/gi, "oauth_token=…");
}

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
  let isMain = !mains?.c ? 1 : 0;
  if (opts.existing) {
    const current = await env.DB.prepare(`SELECT is_main FROM x_accounts WHERE id = ?`)
      .bind(opts.accountId)
      .first<{ is_main: number }>();
    if (current?.is_main) isMain = 1;
  }

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
    oauth1_configured: Boolean(c.env.X_API_KEY && c.env.X_API_SECRET),
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
