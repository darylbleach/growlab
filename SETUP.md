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
| `X_CLIENT_ID` / `X_CLIENT_SECRET` | **OAuth 2.0** Client ID & Client Secret from [console.x.com](https://console.x.com) → your app → **Keys and tokens** (not the OAuth 1.0a API Key/Secret). Client ID should decode to a `:ci` confidential client for Web App. |
| `X_API_KEY` / `X_API_SECRET` | OAuth 1.0a Consumer Key/Secret (optional legacy; Connect X uses OAuth 2.0) |
| `X_BEARER_TOKEN` | App-only bearer (optional) |
| `OPENAI_API_KEY` | OpenAI — needs billing credits on the OpenAI org |
| `ANTHROPIC_API_KEY` | optional Anthropic fallback |

## Connect X — console.x.com checklist (required)

The live authorize URL is correct. If X shows **"Something went wrong / You weren't able to give access to the App"**, User authentication is almost always still on **Set up** (not configured). Complete every field below, **Save**, wait ~1–2 minutes, then retry **Connect X**.

1. Open [console.x.com](https://console.x.com) → your Project → app (**Grow Lab** / similar).
2. Find **User authentication settings** → click **Set up** (or **Edit** if already configured).
3. **App permissions**  
   Choose **Read and write and Direct message**.  
   GrowLab requests `tweet.read tweet.write users.read offline.access like.read follows.read dm.read dm.write`. Without Direct message, DM scopes can cause authorize to fail.
4. **Type of App**  
   Choose **Web App, Automated App or Bot** (confidential client).  
   Do **not** choose Native App / Single Page App — those are public (`:na`) clients; GrowLab exchanges the code with HTTP Basic + Client Secret.
5. **App info**  
   - **Callback URI / Redirect URL** (exact, no trailing slash):

     ```
     https://growlab.darylbleach.workers.dev/oauth/x/callback
     ```

   - **Website URL**:

     ```
     https://growlab.darylbleach.workers.dev
     ```

   - Optional: Organization name / Terms / Privacy can be left blank or set to the same site.
6. Click **Save**. Confirm the page no longer only shows **Set up** — it should show configured OAuth 2.0 / permissions summary.
7. Open **Keys and tokens** → confirm **OAuth 2.0 Client ID** is still `MHVmcXl0RVZ1SURSZGxPM19HY0s6MTpjaQ` (or update Worker secrets `X_CLIENT_ID` / `X_CLIENT_SECRET` if X rotated them after save).
8. In GrowLab → Settings → **Connect X** → authorize on X → you should land back on `/?connected=1`.

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

## Optional

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
