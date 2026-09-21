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
| `X_API_KEY` / `X_API_SECRET` | Consumer Key/Secret from [console.x.com](https://console.x.com) → Keys and tokens (OAuth 1.0a). Paste as text — screenshot OCR is unreliable. |
| `X_CLIENT_ID` / `X_CLIENT_SECRET` | Same Consumer Key/Secret mirrored (optional) |
| `X_BEARER_TOKEN` | App-only bearer (optional) |
| `OPENAI_API_KEY` | OpenAI — needs billing credits on the OpenAI org |
| `ANTHROPIC_API_KEY` | optional Anthropic fallback |

**X app settings (User authentication / OAuth 1.0a):**

- Callback URL (must match exactly):

```
https://growlab.darylbleach.workers.dev/oauth/x/callback
```

- Enable **Read and write** (+ Direct Messages if you want Engage DMs)
- Then open GrowLab → **Connect X**

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
