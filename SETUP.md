# GrowLab — live setup

**URL:** https://growlab.darylbleach.workers.dev

## Login

App password (also stored as Worker secret `APP_PASSWORD`):

```
9f3d851ee2c83d5052bfd2587baffc75
```

Change it anytime in Cloudflare → Workers → growlab → Settings → Variables → `APP_PASSWORD`.

## To unlock X posting / AI (do when you wake up)

Add these Worker secrets on `growlab`:

1. `X_CLIENT_ID` — from https://console.x.com
2. `X_CLIENT_SECRET`
3. `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY`

X OAuth callback URL to register:

```
https://growlab.darylbleach.workers.dev/oauth/x/callback
```

Then open GrowLab → **Connect X**.

Optional:

- `BLUESKY_HANDLE` / `BLUESKY_APP_PASSWORD` or connect in Settings UI

## Cloudflare resources created

| Resource | Name / ID |
|----------|-----------|
| Worker | `growlab` |
| D1 | `growlab` (`aa0c5b25-6ebe-4a07-92c7-652a4cb729a1`) |
| R2 | `growlab-media` |
| KV | `GROWLAB_KV` (`496a933e0a2049ca8a0e03a87e52b3b6`) |
| Queue | `growlab-jobs` |
| Cron | `* * * * *` |

## Redeploy from this repo

```bash
pnpm install
pnpm build
# upload dist via bootstrap or wrangler:
pnpm exec wrangler deploy
```

Or with the deploy uploader (secret `DEPLOY_SECRET` on the Worker):

```bash
SECRET=... # from Cloudflare secrets
BASE=https://growlab.darylbleach.workers.dev
curl -X PUT "$BASE/__deploy?key=deploy/worker.js" -H "x-deploy-secret: $SECRET" --data-binary @dist/worker.js
# then re-PUT the worker script via wrangler / API (see scripts/deploy-from-r2)
```

## Safety

- DMs never auto-send; require explicit flush with confirm
- Automations are per-post opt-in
