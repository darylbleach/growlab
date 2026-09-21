# OAuth probe status (live)

Live Worker has expanded `/oauth/x/probe` and `/oauth/x/start-oauth1`.

Root cause: X rejects the Worker’s stored OAuth2 Client ID/Secret under every token-exchange style (and OAuth1 `request_token` also 401s). GrowLab exchange code matches the official SDK — not a Basic/PKCE/host bug.

**Need from user (plain text, copy buttons, not screenshots):**
```
X_CLIENT_ID=...
X_CLIENT_SECRET=...   # regenerate then copy immediately
X_API_KEY=...
X_API_SECRET=...
```
Then re-probe until `credentials_ok: true`.
