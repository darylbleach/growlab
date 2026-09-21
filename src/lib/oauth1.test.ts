import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAccessTokenExchange, oauth1RealIpHeader, oauth1Sign, oauth1SigningKey } from "./oauth1.ts";

const fixed = { nonce: "nonce123", timestamp: "1700000000" };

test("access_token signature uses the request token secret", async () => {
  const withSecret = await buildAccessTokenExchange({
    consumerKey: "consumer-key",
    consumerSecret: "consumer-secret",
    oauthToken: "request-token",
    oauthTokenSecret: "request-token-secret",
    verifier: "verifier value!",
    ...fixed,
  });
  const consumerOnly = await buildAccessTokenExchange({
    consumerKey: "consumer-key",
    consumerSecret: "consumer-secret",
    oauthToken: "request-token",
    oauthTokenSecret: "",
    verifier: "verifier value!",
    ...fixed,
  });

  assert.equal(withSecret.method, "POST");
  assert.equal(withSecret.url, "https://api.x.com/oauth/access_token");
  assert.equal(withSecret.signingKeyIncludesTokenSecret, true);
  assert.equal(consumerOnly.signingKeyIncludesTokenSecret, false);
  assert.notEqual(withSecret.signature, consumerOnly.signature);
  assert.equal(
    withSecret.signingKey,
    oauth1SigningKey("consumer-secret", "request-token-secret"),
  );
  assert.ok(withSecret.signingKey.endsWith(encodeURIComponent("request-token-secret")));
  assert.equal(withSecret.signingKey.endsWith("&"), false);
});

test("oauth_verifier is signed in the body and omitted from the Authorization header", async () => {
  const exchange = await buildAccessTokenExchange({
    consumerKey: "ck",
    consumerSecret: "cs",
    oauthToken: "reqtok",
    oauthTokenSecret: "reqsec",
    verifier: "verifier value!",
    ...fixed,
  });

  assert.equal(exchange.headerIncludesVerifier, false);
  assert.equal(exchange.signedIncludesVerifier, true);
  assert.equal(exchange.authorization.includes("oauth_verifier"), false);
  assert.match(exchange.baseString, /oauth_verifier/);
  assert.equal(exchange.body, "oauth_verifier=verifier+value%21");
  assert.match(exchange.baseString, /^POST&https%3A%2F%2Fapi\.x\.com%2Foauth%2Faccess_token&/);
});

test("changing only the request token secret changes the access_token signature", async () => {
  const base = {
    consumerKey: "ck",
    consumerSecret: "cs",
    oauthToken: "reqtok",
    verifier: "ver",
    ...fixed,
  };
  const a = await oauth1Sign(
    "POST",
    "https://api.x.com/oauth/access_token",
    base.consumerKey,
    base.consumerSecret,
    base.oauthToken,
    "secret-a",
    {},
    { oauth_verifier: base.verifier },
    fixed,
  );
  const b = await oauth1Sign(
    "POST",
    "https://api.x.com/oauth/access_token",
    base.consumerKey,
    base.consumerSecret,
    base.oauthToken,
    "secret-b",
    {},
    { oauth_verifier: base.verifier },
    fixed,
  );
  assert.notEqual(a.signingKey, b.signingKey);
  assert.notEqual(a.signature, b.signature);
  assert.equal(a.signedParamNames.includes("oauth_verifier"), true);
  assert.equal(a.headerParamNames.includes("oauth_verifier"), false);
  assert.equal(a.headerParamNames.includes("oauth_token"), true);
});

test("access_token forwards only a valid IPv4 as x-real-ip", () => {
  assert.deepEqual(oauth1RealIpHeader("203.0.113.10"), { "x-real-ip": "203.0.113.10" });
  assert.deepEqual(oauth1RealIpHeader(" 198.51.100.4 "), { "x-real-ip": "198.51.100.4" });
  assert.deepEqual(oauth1RealIpHeader("2001:db8::1"), {});
  assert.deepEqual(oauth1RealIpHeader("999.1.1.1"), {});
  assert.deepEqual(oauth1RealIpHeader(""), {});
  assert.deepEqual(oauth1RealIpHeader(null), {});
});
