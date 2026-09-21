import type { Env } from "../env";

/** OAuth 1.0a HMAC-SHA1 helpers for X user-context auth */

/** Access-token host. POST here directly so the signature base string matches the request URL. */
export const OAUTH1_REQUEST_TOKEN_URL = "https://api.x.com/oauth/request_token";
export const OAUTH1_ACCESS_TOKEN_URL = "https://api.x.com/oauth/access_token";

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function oauth1SigningKey(consumerSecret: string, tokenSecret?: string): string {
  return `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret || "")}`;
}

/** X's edge returns HTTP 500 HTML ("This page is down") for Worker egress on access_token unless the browser's IPv4 is forwarded. */
export function oauth1RealIpHeader(candidate: string | null | undefined): Record<string, string> {
  const ip = (candidate || "").trim();
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!match) return {};
  const octets = [match[1], match[2], match[3], match[4]].map((part) => Number(part));
  if (octets.some((n) => n > 255)) return {};
  return { "x-real-ip": ip };
}

/** Strip token material from provider bodies before they reach an HTML error page. */
export function redactOauthMaterial(message: string): string {
  return message
    .replace(/oauth_token_secret=[^&\s"'<>]+/gi, "oauth_token_secret=\u2026")
    .replace(/oauth_token=[^&\s"'<>]+/gi, "oauth_token=\u2026")
    .replace(/oauth_verifier=[^&\s"'<>]+/gi, "oauth_verifier=\u2026")
    .replace(/oauth_nonce=[^&\s"'<>]+/gi, "oauth_nonce=\u2026")
    .replace(/oauth_signature="[^"]*"/gi, 'oauth_signature="\u2026"')
    .replace(/oauth_signature=[^&\s"'<>]+/gi, "oauth_signature=\u2026");
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

export type Oauth1Signature = {
  authorization: string;
  baseString: string;
  signingKey: string;
  signature: string;
  /** Names placed in the Authorization header (includes oauth_signature). */
  headerParamNames: string[];
  /** Names covered by the signature base string (excludes oauth_signature). */
  signedParamNames: string[];
};

export async function oauth1Sign(
  method: string,
  url: string,
  consumerKey: string,
  consumerSecret: string,
  token?: string,
  tokenSecret?: string,
  extraParams: Record<string, string> = {},
  signOnly: Record<string, string> = {},
  fixed?: { nonce?: string; timestamp?: string },
): Promise<Oauth1Signature> {
  const headerParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: fixed?.nonce || crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: fixed?.timestamp || Math.floor(Date.now() / 1000).toString(),
    oauth_version: "1.0",
    ...extraParams,
  };
  if (token) headerParams.oauth_token = token;

  const urlObj = new URL(url);
  const baseUrl = `${urlObj.origin}${urlObj.pathname}`;
  const queryParams: Record<string, string> = {};
  urlObj.searchParams.forEach((v, k) => {
    queryParams[k] = v;
  });

  const signed: Record<string, string> = { ...queryParams, ...signOnly, ...headerParams };
  const paramString = Object.keys(signed)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(signed[k])}`)
    .join("&");

  const baseString = [method.toUpperCase(), percentEncode(baseUrl), percentEncode(paramString)].join("&");
  const signingKey = oauth1SigningKey(consumerSecret, tokenSecret);
  const signature = await hmacSha1Base64(signingKey, baseString);
  headerParams.oauth_signature = signature;

  const authorization =
    "OAuth " +
    Object.keys(headerParams)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(headerParams[k])}"`)
      .join(", ");

  return {
    authorization,
    baseString,
    signingKey,
    signature,
    headerParamNames: Object.keys(headerParams).sort(),
    signedParamNames: Object.keys(signed).sort(),
  };
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
  const signed = await oauth1Sign(method, url, consumerKey, consumerSecret, token, tokenSecret, extraParams);
  return signed.authorization;
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
  const url = OAUTH1_REQUEST_TOKEN_URL;
  const auth = await oauth1Header("POST", url, key, secret, undefined, undefined, {
    oauth_callback: callbackUrl,
  });
  const res = await fetch(url, {
    method: "POST",
    redirect: "manual",
    headers: { Authorization: auth },
  });
  const text = await res.text();
  if (!res.ok) {
    const safe = redactOauthMaterial(text).slice(0, 180);
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

export type AccessTokenExchange = {
  url: string;
  method: "POST";
  body: string;
  authorization: string;
  baseString: string;
  signingKey: string;
  signature: string;
  headerIncludesVerifier: boolean;
  signedIncludesVerifier: boolean;
  signingKeyIncludesTokenSecret: boolean;
};

/**
 * Build the access_token POST.
 * oauth_verifier is a form body parameter and is covered by the signature, but it is
 * not repeated in the Authorization header. The signing key is
 * percentEncode(consumerSecret)&percentEncode(requestTokenSecret).
 */
export async function buildAccessTokenExchange(input: {
  consumerKey: string;
  consumerSecret: string;
  oauthToken: string;
  oauthTokenSecret: string;
  verifier: string;
  nonce?: string;
  timestamp?: string;
}): Promise<AccessTokenExchange> {
  const url = OAUTH1_ACCESS_TOKEN_URL;
  const signed = await oauth1Sign(
    "POST",
    url,
    input.consumerKey,
    input.consumerSecret,
    input.oauthToken,
    input.oauthTokenSecret,
    {},
    { oauth_verifier: input.verifier },
    { nonce: input.nonce, timestamp: input.timestamp },
  );
  const consumerOnlyKey = oauth1SigningKey(input.consumerSecret, "");
  return {
    url,
    method: "POST",
    body: new URLSearchParams({ oauth_verifier: input.verifier }).toString(),
    authorization: signed.authorization,
    baseString: signed.baseString,
    signingKey: signed.signingKey,
    signature: signed.signature,
    headerIncludesVerifier: signed.headerParamNames.includes("oauth_verifier"),
    signedIncludesVerifier: signed.signedParamNames.includes("oauth_verifier"),
    signingKeyIncludesTokenSecret:
      Boolean(input.oauthTokenSecret) && signed.signingKey !== consumerOnlyKey,
  };
}

export async function oauth1AccessToken(
  env: Env,
  oauthToken: string,
  oauthTokenSecret: string,
  verifier: string,
  clientIp?: string | null,
) {
  if (!oauthTokenSecret) {
    throw new Error("access_token failed: missing request token secret");
  }
  const { key, secret } = consumerCreds(env);
  const exchange = await buildAccessTokenExchange({
    consumerKey: key,
    consumerSecret: secret,
    oauthToken,
    oauthTokenSecret,
    verifier,
  });
  const res = await fetch(exchange.url, {
    method: exchange.method,
    redirect: "manual",
    headers: {
      Authorization: exchange.authorization,
      "Content-Type": "application/x-www-form-urlencoded",
      ...oauth1RealIpHeader(clientIp),
    },
    body: exchange.body,
  });
  const text = await res.text();
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location") || "";
    throw new Error(
      `access_token failed: ${res.status} redirect:${redactOauthMaterial(location).slice(0, 120)}`,
    );
  }
  if (!res.ok) {
    throw new Error(`access_token failed: ${res.status} ${redactOauthMaterial(text).slice(0, 300)}`);
  }
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
