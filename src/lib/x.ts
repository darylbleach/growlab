import type { Env } from "../env";
import { decryptText, encryptText } from "./crypto";
import { consumerCreds, oauth1Header } from "./oauth1";

// Current X docs use x.com; twitter.com still aliases but prefer the canonical host.
const X_AUTH = "https://x.com/i/oauth2/authorize";
const X_TOKEN = "https://api.x.com/2/oauth2/token";
const X_API = "https://api.x.com/2";

export const X_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "offline.access",
  "like.read",
  "follows.read",
  "dm.read",
  "dm.write",
].join(" ");

/** Auth context for user-context X API calls (OAuth 1.0a or OAuth 2.0). */
export type XAuth = {
  mode: "oauth1" | "oauth2";
  accessToken: string;
  tokenSecret?: string;
};

/** Trim pasted secrets; OCR/copy often adds whitespace that breaks Basic auth. */
export function xClientId(env: Env): string {
  return (env.X_CLIENT_ID || "").trim();
}

export function xClientSecret(env: Env): string {
  return (env.X_CLIENT_SECRET || "").trim();
}

export function xConfigured(env: Env): boolean {
  return Boolean(xClientId(env) && xClientSecret(env));
}

export function buildAuthUrl(env: Env, state: string, codeChallenge: string): string {
  // Build query with encodeURIComponent so scopes use %20 (X docs), not +.
  const q = [
    ["response_type", "code"],
    ["client_id", xClientId(env)],
    ["redirect_uri", `${env.APP_URL}/oauth/x/callback`],
    ["scope", X_SCOPES],
    ["state", state],
    ["code_challenge", codeChallenge],
    ["code_challenge_method", "S256"],
  ]
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `${X_AUTH}?${q}`;
}

export async function exchangeCode(
  env: Env,
  code: string,
  codeVerifier: string,
): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}> {
  const clientId = xClientId(env);
  const clientSecret = xClientSecret(env);
  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: `${env.APP_URL}/oauth/x/callback`,
    code_verifier: codeVerifier,
  });
  const basic = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(X_TOKEN, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`X token exchange failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function refreshAccessToken(env: Env, refreshToken: string) {
  const clientId = xClientId(env);
  const clientSecret = xClientSecret(env);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const basic = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(X_TOKEN, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`X refresh failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  }>;
}

export async function xFetch(
  env: Env,
  auth: XAuth | string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${X_API}${path}`;
  const method = (init?.method || "GET").toUpperCase();
  const xAuth: XAuth =
    typeof auth === "string" ? { mode: "oauth2", accessToken: auth } : auth;

  if (xAuth.mode === "oauth1") {
    const { key, secret } = consumerCreds(env);
    const authorization = await oauth1Header(
      method,
      url,
      key,
      secret,
      xAuth.accessToken,
      xAuth.tokenSecret,
    );
    const headers: Record<string, string> = {
      Authorization: authorization,
      ...(init?.headers as Record<string, string> | undefined),
    };
    if (init?.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    return fetch(url, { ...init, method, headers });
  }

  return fetch(url, {
    ...init,
    method,
    headers: {
      Authorization: `Bearer ${xAuth.accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
}

export async function getMe(env: Env, auth: XAuth | string) {
  const res = await xFetch(
    env,
    auth,
    "/users/me?user.fields=profile_image_url,description,public_metrics,verified",
  );
  if (!res.ok) throw new Error(`users/me failed: ${await res.text()}`);
  const json = (await res.json()) as {
    data: {
      id: string;
      username: string;
      name: string;
      profile_image_url?: string;
    };
  };
  return json.data;
}

export async function createTweet(
  env: Env,
  auth: XAuth | string,
  text: string,
  replyTo?: string,
): Promise<{ id: string }> {
  const body: Record<string, unknown> = { text };
  if (replyTo) body.reply = { in_reply_to_tweet_id: replyTo };
  const res = await xFetch(env, auth, "/tweets", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`create tweet failed: ${await res.text()}`);
  const json = (await res.json()) as { data: { id: string } };
  return json.data;
}

export async function deleteTweet(env: Env, auth: XAuth | string, tweetId: string) {
  const res = await xFetch(env, auth, `/tweets/${tweetId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`delete tweet failed: ${await res.text()}`);
}

export async function retweet(env: Env, auth: XAuth | string, userId: string, tweetId: string) {
  const res = await xFetch(env, auth, `/users/${userId}/retweets`, {
    method: "POST",
    body: JSON.stringify({ tweet_id: tweetId }),
  });
  if (!res.ok) throw new Error(`retweet failed: ${await res.text()}`);
}

export async function searchRecent(env: Env, auth: XAuth | string, query: string, max = 20) {
  const params = new URLSearchParams({
    query,
    max_results: String(Math.min(Math.max(max, 10), 100)),
    "tweet.fields": "public_metrics,created_at,author_id",
    expansions: "author_id",
    "user.fields": "username,name,profile_image_url,public_metrics,description",
  });
  const res = await xFetch(env, auth, `/tweets/search/recent?${params}`);
  if (!res.ok) throw new Error(`search failed: ${await res.text()}`);
  return res.json() as Promise<{
    data?: Array<{
      id: string;
      text: string;
      author_id: string;
      created_at?: string;
      public_metrics?: {
        like_count: number;
        reply_count: number;
        retweet_count: number;
        quote_count: number;
        impression_count?: number;
      };
    }>;
    includes?: {
      users?: Array<{
        id: string;
        username: string;
        name: string;
        description?: string;
        profile_image_url?: string;
        public_metrics?: { followers_count: number; following_count: number };
      }>;
    };
  }>;
}

export async function listUserTweets(env: Env, auth: XAuth | string, userId: string, max = 50) {
  const params = new URLSearchParams({
    max_results: String(Math.min(Math.max(max, 5), 100)),
    "tweet.fields": "public_metrics,created_at,in_reply_to_user_id",
    exclude: "retweets",
  });
  const res = await xFetch(env, auth, `/users/${userId}/tweets?${params}`);
  if (!res.ok) throw new Error(`user tweets failed: ${await res.text()}`);
  return res.json() as Promise<{
    data?: Array<{
      id: string;
      text: string;
      created_at?: string;
      in_reply_to_user_id?: string;
      public_metrics?: {
        like_count: number;
        reply_count: number;
        retweet_count: number;
        quote_count: number;
        impression_count?: number;
        bookmark_count?: number;
      };
    }>;
  }>;
}

export async function sendDm(
  env: Env,
  auth: XAuth | string,
  participantId: string,
  text: string,
) {
  const res = await xFetch(env, auth, `/dm_conversations/with/${participantId}/messages`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`DM failed: ${await res.text()}`);
  return res.json();
}

export type AccountTokens = {
  id: string;
  x_user_id: string;
  handle: string;
  access_token_enc: string;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  scopes?: string | null;
};

export async function getValidAccessToken(env: Env, account: AccountTokens): Promise<XAuth> {
  const access = await decryptText(env.TOKEN_ENCRYPTION_SECRET, account.access_token_enc);
  const isOauth1 = (account.scopes || "").includes("oauth1");

  if (isOauth1) {
    if (!account.refresh_token_enc) {
      throw new Error("OAuth 1.0a account missing token secret");
    }
    const tokenSecret = await decryptText(env.TOKEN_ENCRYPTION_SECRET, account.refresh_token_enc);
    return { mode: "oauth1", accessToken: access, tokenSecret };
  }

  let accessToken = access;
  const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (expiresAt && expiresAt < Date.now() + 60_000 && account.refresh_token_enc) {
    const refresh = await decryptText(env.TOKEN_ENCRYPTION_SECRET, account.refresh_token_enc);
    const tokens = await refreshAccessToken(env, refresh);
    accessToken = tokens.access_token;
    const accessEnc = await encryptText(env.TOKEN_ENCRYPTION_SECRET, tokens.access_token);
    const refreshEnc = tokens.refresh_token
      ? await encryptText(env.TOKEN_ENCRYPTION_SECRET, tokens.refresh_token)
      : account.refresh_token_enc;
    const exp = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    await env.DB.prepare(
      `UPDATE x_accounts SET access_token_enc = ?, refresh_token_enc = ?, token_expires_at = ?, updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(accessEnc, refreshEnc, exp, account.id)
      .run();
  }
  return { mode: "oauth2", accessToken };
}

export function estimateXWriteCost(text: string): number {
  return /https?:\/\//i.test(text) ? 0.2 : 0.015;
}
