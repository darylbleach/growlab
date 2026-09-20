# GrowLab Agent Skill

Personal X growth OS at https://growlab.darylbleach.workers.dev

## Auth

Use an API key created in Settings (Bearer `glk_...`) or ask the user to be logged in.

```bash
export GROWLAB_URL=https://growlab.darylbleach.workers.dev
export GROWLAB_KEY=glk_...
node apps/cli/growlab.mjs me
```

## Typical growth loop

1. `GET /api/analytics` — what worked
2. `GET /api/inspiration?q=...` or ingest
3. `POST /api/ai/write` with a brief
4. `POST /api/ai/score` on the draft
5. `POST /api/posts` with `scheduled_for` or `publish_now`
6. `GET /api/engage/feeds/:id/posts` + `POST /api/ai/reply` for replies
7. `POST /api/signals/agents` + poll `/api/signals/leads` for outreach

## Rules

- Prefer drafts for review over auto-publish unless user asks
- Never flush DMs without explicit user confirmation
- Watch `/api/usage` — X API link posts cost ~$0.20 each
- Do not invent X credentials; user must set Worker secrets
