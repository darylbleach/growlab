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
   GrowLab probes the token endpoint with the stored secrets; `invalid_client` means regenerate keys (do **not** reuse a secret generated while the app was Native/Public, and do **not** paste from a screenshot/OCR).
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

Expect `credentials_ok: true` (token error `invalid_grant` for a fake code). `invalid_client` means the stored Client ID/Secret are wrong.

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
