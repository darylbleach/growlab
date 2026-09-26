import type { Env } from "../env";

/** OAuth 1.0a HMAC-SHA1 helpers for X user-context auth (media upload + API calls). */

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function oauth1SigningKey(consumerSecret: string, tokenSecret?: string): string {
  return `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret || "")}`;
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

  return { authorization, baseString, signingKey, signature };
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

/** True when OAuth 1.0a consumer secrets are set (API Key / API Secret). */
export function oauth1Configured(env: Env): boolean {
  return Boolean((env.X_API_KEY || "").trim() && (env.X_API_SECRET || "").trim());
}

export function consumerCreds(env: Env): { key: string; secret: string } {
  return {
    key: (env.X_API_KEY || env.X_CLIENT_ID || "").trim(),
    secret: (env.X_API_SECRET || env.X_CLIENT_SECRET || "").trim(),
  };
}
