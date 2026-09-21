import { useEffect, useState } from "react";
import { api, type Account, type ScheduledPost } from "./lib/api";

type Tab =
  | "home"
  | "compose"
  | "queue"
  | "ai"
  | "analytics"
  | "engage"
  | "signals"
  | "inspiration"
  | "audience"
  | "automations"
  | "articles"
  | "settings";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "home", label: "Home" },
  { id: "compose", label: "Compose" },
  { id: "queue", label: "Queue" },
  { id: "ai", label: "AI Studio" },
  { id: "analytics", label: "Analytics" },
  { id: "engage", label: "Engage" },
  { id: "signals", label: "Signals" },
  { id: "inspiration", label: "Inspiration" },
  { id: "audience", label: "Audience" },
  { id: "automations", label: "Automations" },
  { id: "articles", label: "Articles" },
  { id: "settings", label: "Settings" },
];

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("home");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [xConfigured, setXConfigured] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);

  async function refreshAuth() {
    const s = await api.status();
    setAuthed(s.authenticated);
    setXConfigured(s.x_configured);
    setAiConfigured(s.ai_configured);
    if (s.authenticated) {
      const me = await api.me();
      setAccounts(me.data.accounts);
      setXConfigured(me.data.x_configured);
      setAiConfigured(me.data.ai_configured);
    }
  }

  useEffect(() => {
    refreshAuth().catch(() => setAuthed(false));
  }, []);

  if (authed === null) {
    return <div className="login"><div className="login-card">Loading GrowLab…</div></div>;
  }

  if (!authed) {
    return (
      <div className="login">
        <form
          className="login-card"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              await api.login(password);
              await refreshAuth();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Login failed");
            }
          }}
        >
          <h1>GrowLab</h1>
          <p>Your private X growth OS on Cloudflare.</p>
          <div className="stack">
            <input
              className="input"
              type="password"
              placeholder="App password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            {error && <div className="error">{error}</div>}
            <button className="btn" type="submit">Enter</button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">Grow<span>Lab</span></div>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`nav-btn ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          className="nav-btn"
          onClick={async () => {
            await api.logout();
            setAuthed(false);
          }}
        >
          Log out
        </button>
      </aside>
      <main className="main">
        {tab === "home" && (
          <Home
            accounts={accounts}
            xConfigured={xConfigured}
            aiConfigured={aiConfigured}
            onRefresh={refreshAuth}
          />
        )}
        {tab === "compose" && <Compose aiConfigured={aiConfigured} />}
        {tab === "queue" && <Queue />}
        {tab === "ai" && <AiStudio aiConfigured={aiConfigured} />}
        {tab === "analytics" && <Analytics />}
        {tab === "engage" && <Engage />}
        {tab === "signals" && <Signals />}
        {tab === "inspiration" && <Inspiration />}
        {tab === "audience" && <Audience />}
        {tab === "automations" && <Automations />}
        {tab === "articles" && <Articles />}
        {tab === "settings" && (
          <Settings
            accounts={accounts}
            xConfigured={xConfigured}
            aiConfigured={aiConfigured}
            onRefresh={refreshAuth}
          />
        )}
      </main>
    </div>
  );
}

function Home({
  accounts,
  xConfigured,
  aiConfigured,
  onRefresh,
}: {
  accounts: Account[];
  xConfigured: boolean;
  aiConfigured: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [usage, setUsage] = useState<any>(null);
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  useEffect(() => {
    api.usage().then((u) => setUsage(u.data)).catch(() => null);
    api.posts().then((p) => setPosts(p.data.slice(0, 5))).catch(() => null);
    onRefresh();
  }, []);

  return (
    <div>
      <h1 className="page-title">Growth cockpit</h1>
      <p className="page-sub">Schedule, write, engage, and find leads — without the $49/mo bill.</p>
      <div className="stat-row" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="n">{accounts.length}</div><div className="l">X accounts</div></div>
        <div className="stat"><div className="n">{posts.filter((p) => p.status === "queued").length}</div><div className="l">Queued</div></div>
        <div className="stat"><div className="n">{xConfigured ? "ON" : "OFF"}</div><div className="l">X API</div></div>
        <div className="stat"><div className="n">{aiConfigured ? "ON" : "OFF"}</div><div className="l">AI keys</div></div>
      </div>
      <div className="grid-2">
        <div className="panel">
          <h3>Setup checklist</h3>
          <div className="list">
            <div className="item">
              App login <span className="pill ok">done</span>
            </div>
            <div className="item">
              X developer app secrets{" "}
              <span className={`pill ${xConfigured ? "ok" : "warn"}`}>{xConfigured ? "ready" : "needed"}</span>
              {!xConfigured && (
                <div className="meta">Connect X uses OAuth 1.0a (X_API_KEY + X_API_SECRET).</div>
              )}
            </div>
            <div className="item">
              Connect X account{" "}
              <span className={`pill ${accounts.length ? "ok" : "warn"}`}>
                {accounts.length ? accounts.map((a) => `@${a.handle}`).join(", ") : "none"}
              </span>
              <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
                <a className="btn secondary" href="/oauth/x/start-oauth1">Connect X</a>
                {xConfigured && (
                  <a className="btn ghost" href="/oauth/x/start">OAuth 2 (not primary)</a>
                )}
              </div>
            </div>
            <div className="item">
              LLM API key{" "}
              <span className={`pill ${aiConfigured ? "ok" : "warn"}`}>{aiConfigured ? "ready" : "optional"}</span>
              <div className="meta">OPENAI_API_KEY or ANTHROPIC_API_KEY</div>
            </div>
          </div>
        </div>
        <div className="panel">
          <h3>30-day usage</h3>
          {!usage ? (
            <div className="empty">No usage yet.</div>
          ) : (
            <div className="stack">
              <div className="stat"><div className="n">${Number(usage.total_30d_usd || 0).toFixed(2)}</div><div className="l">Estimated cost</div></div>
              {(usage.by_kind || []).map((k: any) => (
                <div className="item" key={k.kind}>
                  {k.kind} · {k.events} events · ${Number(k.cost_usd || 0).toFixed(3)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Recent posts</h3>
        <div className="list">
          {posts.length === 0 && <div className="empty">Nothing scheduled yet.</div>}
          {posts.map((p) => (
            <div className="item" key={p.id}>
              <div>{p.text.slice(0, 180)}</div>
              <div className="meta">{p.status} · {p.scheduled_for || p.created_at}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
