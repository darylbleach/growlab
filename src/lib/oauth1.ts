import type { Env } from "../env";

/** OAuth 1.0a HMAC-SHA1 helpers for X user-context auth */

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function hmacSha1Base64(key: string, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function oauth1Header(
  method: string,
  url: string,
  consumerKey: string,
  consumerSecret: string,
  token?: string,
  tokenSecret?: string,
  extraParams: Record<string, string> = {},
): Promise<string> {
  const oauth: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: "1.0",
    ...extraParams,
  };
  if (token) oauth.oauth_token = token;

  const urlObj = new URL(url);
  const baseUrl = `${urlObj.origin}${urlObj.pathname}`;
  const queryParams: Record<string, string> = {};
  urlObj.searchParams.forEach((v, k) => {
    queryParams[k] = v;
  });

  const all = { ...queryParams, ...oauth };
  const paramString = Object.keys(all)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(all[k])}`)
    .join("&");

  const baseString = [method.toUpperCase(), percentEncode(baseUrl), percentEncode(paramString)].join("&");
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret || "")}`;
  oauth.oauth_signature = await hmacSha1Base64(signingKey, baseString);

  const header = Object.keys(oauth)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauth[k])}"`)
    .join(", ");
  return `OAuth ${header}`;
}

export function oauth1Configured(env: Env): boolean {
  return Boolean((env.X_API_KEY || env.X_CLIENT_ID) && (env.X_API_SECRET || env.X_CLIENT_SECRET));
}

export function consumerCreds(env: Env): { key: string; secret: string } {
  return {
    key: (env.X_API_KEY || env.X_CLIENT_ID || "").trim(),
    secret: (env.X_API_SECRET || env.X_CLIENT_SECRET || "").trim(),
  };
}

export async function oauth1RequestToken(env: Env, callbackUrl: string) {
  const { key, secret } = consumerCreds(env);
  const url = "https://api.twitter.com/oauth/request_token";
  const auth = await oauth1Header("POST", url, key, secret, undefined, undefined, {
    oauth_callback: callbackUrl,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: auth },
  });
  const text = await res.text();
  if (!res.ok) {
    const safe = text
      .replace(/oauth_token_secret=[^&\s]+/gi, "oauth_token_secret=…")
      .replace(/oauth_token=[^&\s]+/gi, "oauth_token=…")
      .slice(0, 180);
    throw new Error(`request_token failed: ${res.status} ${safe}`);
  }
  const params = Object.fromEntries(new URLSearchParams(text));
  if (!params.oauth_token || !params.oauth_token_secret) {
    throw new Error("request_token missing tokens");
  }
  if (params.oauth_callback_confirmed && params.oauth_callback_confirmed !== "true") {
    throw new Error(
      `oauth_callback was not confirmed for ${callbackUrl}. Register that exact callback URL on the X app.`,
    );
  }
  return {
    oauth_token: params.oauth_token,
    oauth_token_secret: params.oauth_token_secret,
  };
}

export async function oauth1AccessToken(
  env: Env,
  oauthToken: string,
  oauthTokenSecret: string,
  verifier: string,
) {
  const { key, secret } = consumerCreds(env);
  const url = "https://api.twitter.com/oauth/access_token";
  const auth = await oauth1Header("POST", url, key, secret, oauthToken, oauthTokenSecret, {
    oauth_verifier: verifier,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: auth },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`access_token failed: ${res.status}`);
  const params = Object.fromEntries(new URLSearchParams(text));
  if (!params.oauth_token || !params.oauth_token_secret || !params.user_id) {
    throw new Error("access_token response missing oauth_token, secret, or user_id");
  }
  return {
    oauth_token: params.oauth_token,
    oauth_token_secret: params.oauth_token_secret,
    user_id: params.user_id,
    screen_name: params.screen_name || params.user_id,
  };
}

export function authorizeUrl(oauthToken: string): string {
  return `https://api.twitter.com/oauth/authorize?oauth_token=${encodeURIComponent(oauthToken)}`;
}
