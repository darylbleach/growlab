# GrowLab

Personal X (Twitter) growth OS — SuperX-inspired, self-hosted on **your Cloudflare account**.

**Stack:** Hono Worker API · React SPA · D1 · R2 · Queues · Cron

## Live

- **App:** https://growlab.darylbleach.workers.dev
- **Login / setup:** see [SETUP.md](./SETUP.md) for login instructions and environment configuration.

## Features

- Multi-account X OAuth (PKCE)
- Compose / schedule / publish threads
- AI write / rewrite / thread / reply / score (BYOK)
- Voice context + style guide
- Content workers → review queue
- Analytics sync + best/worst posts
- Engage feeds + reply drafts
- Signal Agents (ICP lead finding)
- Inspiration library (manual + X ingest)
- Audience contacts/lists/notes
- Automations: auto-retweet, auto-plug, auto-delete
- DM campaigns (explicit flush — safe by default)
- Articles drafts + optional AI covers
- Bluesky cross-post
- API keys + CLI + MCP tool stubs
- Usage cost meter

## Deploy

```bash
pnpm install
pnpm db:migrate
pnpm deploy
```

### Secrets (required)

| Secret | Purpose |
|--------|---------|
| `APP_PASSWORD` | Dashboard login |
| `SESSION_SECRET` | Session signing material |
| `TOKEN_ENCRYPTION_SECRET` | Encrypt X/Bluesky tokens at rest |

### Secrets (to unlock full power)

| Secret | Purpose |
|--------|---------|
| `X_CLIENT_ID` / `X_CLIENT_SECRET` | X developer app OAuth |
| `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` | AI features |
| `BLUESKY_HANDLE` / `BLUESKY_APP_PASSWORD` | Optional env-level Bluesky |

Set via:

```bash
wrangler secret put APP_PASSWORD
wrangler secret put SESSION_SECRET
wrangler secret put TOKEN_ENCRYPTION_SECRET
wrangler secret put X_CLIENT_ID
wrangler secret put X_CLIENT_SECRET
wrangler secret put OPENAI_API_KEY
```

Update `APP_URL` in `wrangler.toml` to your `*.workers.dev` or custom domain, and set the same URL as the X OAuth callback: `{APP_URL}/oauth/x/callback`.

### X app setup

1. Create an app at [console.x.com](https://console.x.com)
2. Enable OAuth 2.0, type Web App
3. Callback: `https://<your-worker>/oauth/x/callback`
4. Buy pay-per-use credits
5. Put client id/secret into Worker secrets
6. Open GrowLab → Connect X

## CLI

```bash
GROWLAB_URL=https://growlab.<you>.workers.dev GROWLAB_KEY=glk_... node apps/cli/growlab.mjs analytics
```

Create a key in **Settings → API key**.

## Safety

- Auto-DM never sends until `POST /api/dms/flush` with `{ confirm: true }`
- Automations are opt-in per post
- Aggressive Engage/Signal usage costs X API credits — watch **Usage**

## Local

```bash
pnpm db:migrate:local
pnpm dev
```
