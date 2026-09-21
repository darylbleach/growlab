# GrowLab — you're live

**App:** https://growlab.darylbleach.workers.dev  
**Source:** https://github.com/darylbleach/growlab

## Login password

```
9f3d851ee2c83d5052bfd2587baffc75
```

Change it in Cloudflare Dashboard → Workers & Pages → **growlab** → Settings → Variables and Secrets → `APP_PASSWORD`.

## Unlock X + AI

| Secret | Notes |
|--------|--------|
| `X_CLIENT_ID` / `X_CLIENT_SECRET` | **OAuth 2.0** Client ID & Client Secret from [console.x.com](https://console.x.com) → your app → **Keys and tokens**. **Connect X uses these** (confidential Web App). Client ID should decode to a `:ci` confidential client. |
| `X_API_KEY` / `X_API_SECRET` | OAuth 1.0a Consumer Key/Secret. Used for signing some API calls; OAuth 1.0a Connect cannot finish on Workers because X returns HTTP 500 HTML on `/oauth/access_token` from Worker egress. |
| `X_BEARER_TOKEN` | App-only bearer (optional) |
| `OPENAI_API_KEY` | OpenAI — needs billing credits on the OpenAI org |
| `ANTHROPIC_API_KEY` | optional Anthropic fallback |

## Connect X — console.x.com checklist (required)

If X shows **"Something went wrong / You weren't able to give access to the App"**, check in this order:

1. **Website URL is filled** (required field on the same form as Callback — easy to miss below the fold).
2. **OAuth 2.0 Client ID + Client Secret are valid** for the current app type (Web App / confidential).  
   GrowLab probes the token endpoint with the stored secrets. X returns `invalid_client` for an unknown Client ID, and `unauthorized_client` / "Missing valid authorization header" for a **known confidential Client ID with a wrong Client Secret** (same text as a missing Basic header). Either case → regenerate the Client Secret and update Worker `X_CLIENT_SECRET` (do **not** reuse a secret from when the app was Native/Public, and do **not** paste from a screenshot/OCR).
3. User authentication is **Saved** (not stuck on **Set up**).

### Form fields

1. Open [console.x.com](https://console.x.com) → your Project → app (**Grow Lab 2**).
2. Find **User authentication settings** → **Set up** / **Edit**.
3. **App permissions** → **Read and write and Direct message**.  
   GrowLab requests `tweet.read tweet.write users.read offline.access like.read follows.read dm.read dm.write`.
4. **Type of App** → **Web App, Automated App or Bot** (confidential). Not Native / SPA.
5. **App info**  
   - **Callback URI / Redirect URL** (exact, no trailing slash):

     ```
     https://growlab.darylbleach.workers.dev/oauth/x/callback
     ```

   - **Website URL** (required):

     ```
     https://growlab.darylbleach.workers.dev
     ```

6. Click **Save**.
7. Open **Keys and tokens** → confirm OAuth 2.0 Client ID starts with `VUVocGhQ…` (Grow Lab 2). If you regenerated the Client Secret after saving User auth, paste the new secret into Worker secret `X_CLIENT_SECRET` (and keep `X_CLIENT_ID` in sync).
8. Retry **Connect X** on the dashboard (OAuth 2.0). Probe: `GET /oauth/x/probe` while logged in — expect `credentials_ok: true`.

### Debug probe (logged-in)

```
GET https://growlab.darylbleach.workers.dev/oauth/x/probe
```

Expect `credentials_ok: true` (token error `invalid_grant` for a fake code). `secret_rejected: true` or `invalid_client` means the stored Client Secret (or ID) must be regenerated.

### What GrowLab sends (for debugging)

```
https://x.com/i/oauth2/authorize
  ?response_type=code
  &client_id=<X_CLIENT_ID>
  &redirect_uri=https://growlab.darylbleach.workers.dev/oauth/x/callback
  &scope=tweet.read%20tweet.write%20users.read%20offline.access%20like.read%20follows.read%20dm.read%20dm.write
  &state=...
  &code_challenge=...
  &code_challenge_method=S256
```

Token exchange: `POST https://api.x.com/2/oauth2/token` with `Authorization: Basic base64(client_id:client_secret)` + PKCE `code_verifier` (confidential / Web App).

### OAuth 2.0 — what Connect X uses

The dashboard **Connect X** button opens:

```
https://growlab.darylbleach.workers.dev/oauth/x/start
```

That uses Worker secrets `X_CLIENT_ID` / `X_CLIENT_SECRET`. OAuth 1.0a `/oauth/x/start-oauth1` remains available for diagnostics, but X returns HTTP 500 HTML on Worker `access_token` calls (Cloudflare Worker egress), so that path cannot finish Connect.

Callback:

```
https://growlab.darylbleach.workers.dev/oauth/x/callback
```

After you approve the app, GrowLab exchanges the auth code (PKCE + Basic client auth), encrypts tokens, and redirects to `/?connected=1`.

### OAuth 1.0a note

`request_token` works from the Worker; `access_token` returns X's icecream 500 HTML from Worker IPs even with `x-real-ip` / `x-forwarded-for` (cross-zone CF→`api.x.com` rewrites client-IP headers). Probe: `GET /oauth/x/access-token-probe`.

### Debug probe (logged-in) — expanded

```
GET https://growlab.darylbleach.workers.dev/oauth/x/probe
```

Returns multi-host / multi-style token trials (Basic raw, RFC-urlencoded Basic, body-only, mutated secret, API-secret swap), secret fingerprints (no values), and an OAuth 1.0a `request_token` probe. Expect `credentials_ok: true` for OAuth 2.

- Bluesky: Settings UI, or secrets `BLUESKY_HANDLE` + `BLUESKY_APP_PASSWORD`
- CLI: create an API key in Settings, then `GROWLAB_URL=https://growlab.darylbleach.workers.dev GROWLAB_KEY=glk_... node apps/cli/growlab.mjs me`

## Cloudflare resources

- Worker: `growlab`
- D1: `growlab`
- R2: `growlab-media` (SPA under `site/`)
- KV: `GROWLAB_KV`
- Queue: `growlab-jobs` + consumer
- Cron: every minute

## What works without X/AI secrets

Login, dashboard UI, drafts stored in D1, settings, API keys, usage meter.  
Posting / analytics sync / engage / signals / AI need the secrets above.
