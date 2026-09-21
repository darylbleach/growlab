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
| `X_CLIENT_ID` / `X_CLIENT_SECRET` | OAuth 2.0 Client ID & Client Secret. Not used by the Connect button. A Worker probe with a fake code returns `unauthorized_client` (stored secret rejected). Client ID `VUVocGhQ…` is a confidential `:ci` client. |
| `X_API_KEY` / `X_API_SECRET` | OAuth 1.0a Consumer Key/Secret. **Connect X uses these.** |
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
7. Open **Keys and tokens** → OAuth 1.0a API Key and API Secret must match Worker secrets `X_API_KEY` / `X_API_SECRET`.
8. Retry **Connect X** on the dashboard. That opens `/oauth/x/start` (OAuth 1.0a). After you approve, you land on `/?connected=1&via=oauth1`.

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

### Connect X click path

The dashboard **Connect X** button opens:

```
https://growlab.darylbleach.workers.dev/oauth/x/start
```

That is OAuth 1.0a (`X_API_KEY` / `X_API_SECRET`): request token, approve on X, then `POST https://api.x.com/oauth/access_token` with the verifier in the form body and **no** `x-real-ip` header. From this Worker, a real request token plus a dummy verifier returns `401 Invalid oauth_verifier` (not the icecream HTML 500). A real approval stores encrypted tokens and redirects to `/?connected=1&via=oauth1`.

`/oauth/x/start-oauth1` is the same handler. `/oauth/x/start-oauth2` is the PKCE path and is not the button.

Callback:

```
https://growlab.darylbleach.workers.dev/oauth/x/callback
```

Logged-in probe: `GET /oauth/x/probe-fresh`. OAuth 1 variants should show `Invalid oauth_verifier`. OAuth 2 `authcode_basic` still returns `unauthorized_client` for the stored client secret.

### Debug probe (logged-in) — expanded

```
GET https://growlab.darylbleach.workers.dev/oauth/x/probe
```

Returns multi-host / multi-style token trials, secret fingerprints (no values), and an OAuth 1.0a `request_token` probe. Connect does not depend on `credentials_ok` for OAuth 2. Use `GET /oauth/x/probe-fresh` to confirm `Invalid oauth_verifier`.

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
