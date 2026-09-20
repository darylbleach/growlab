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
                <div className="meta">Set X_CLIENT_ID + X_CLIENT_SECRET on the Worker, then connect.</div>
              )}
            </div>
            <div className="item">
              Connect X account{" "}
              <span className={`pill ${accounts.length ? "ok" : "warn"}`}>
                {accounts.length ? accounts.map((a) => `@${a.handle}`).join(", ") : "none"}
              </span>
              {xConfigured && (
                <div className="row" style={{ marginTop: 8 }}>
                  <a className="btn secondary" href="/oauth/x/start">Connect / reconnect X</a>
                </div>
              )}
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

function Compose({ aiConfigured }: { aiConfigured: boolean }) {
  const [text, setText] = useState("");
  const [brief, setBrief] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [score, setScore] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [autoRt, setAutoRt] = useState("");
  const [autoDel, setAutoDel] = useState("");
  const [crossBsky, setCrossBsky] = useState(false);

  return (
    <div>
      <h1 className="page-title">Compose</h1>
      <p className="page-sub">Draft, score, schedule, or publish now.</p>
      <div className="grid-2">
        <div className="panel stack">
          <h3>Post</h3>
          <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="What's worth posting?" />
          <div className="row">
            <input className="input" style={{ maxWidth: 260 }} type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
            <label className="pill"><input type="checkbox" checked={crossBsky} onChange={(e) => setCrossBsky(e.target.checked)} /> Bluesky</label>
          </div>
          <div className="row">
            <input className="input" style={{ maxWidth: 140 }} placeholder="Auto-RT hours" value={autoRt} onChange={(e) => setAutoRt(e.target.value)} />
            <input className="input" style={{ maxWidth: 140 }} placeholder="Auto-delete hours" value={autoDel} onChange={(e) => setAutoDel(e.target.value)} />
          </div>
          <div className="row">
            <button
              className="btn"
              disabled={busy || !text.trim()}
              onClick={async () => {
                setBusy(true); setErr(""); setMsg("");
                try {
                  await api.createPost({
                    text,
                    scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : null,
                    auto_retweet_hours: autoRt ? Number(autoRt) : null,
                    auto_delete_hours: autoDel ? Number(autoDel) : null,
                    cross_post_bluesky: crossBsky,
                  });
                  setMsg("Saved.");
                  setText("");
                } catch (e) {
                  setErr(e instanceof Error ? e.message : "Failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save / schedule
            </button>
            <button
              className="btn secondary"
              disabled={busy || !text.trim()}
              onClick={async () => {
                setBusy(true); setErr(""); setMsg("");
                try {
                  await api.createPost({ text, publish_now: true, cross_post_bluesky: crossBsky });
                  setMsg("Queued for publish.");
                  setText("");
                } catch (e) {
                  setErr(e instanceof Error ? e.message : "Failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Publish now
            </button>
            <button
              className="btn ghost"
              disabled={busy || !text.trim() || !aiConfigured}
              onClick={async () => {
                setBusy(true);
                try {
                  setScore(await (await api.score(text)).data);
                } catch (e) {
                  setErr(e instanceof Error ? e.message : "Score failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Score draft
            </button>
          </div>
          {msg && <div className="success">{msg}</div>}
          {err && <div className="error">{err}</div>}
          {score && (
            <div className="item">
              Score: <strong>{score.score}</strong>
              <div className="meta">{JSON.stringify(score.helps || [])}</div>
              <div className="meta">{JSON.stringify(score.hurts || [])}</div>
            </div>
          )}
        </div>
        <div className="panel stack">
          <h3>AI assist</h3>
          <textarea className="textarea" value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Brief: launch day reflection, thread on pricing…" />
          <div className="row">
            <button
              className="btn secondary"
              disabled={!aiConfigured || busy || !brief.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await api.write(brief);
                  setText(r.data.text);
                } catch (e) {
                  setErr(e instanceof Error ? e.message : "AI failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Write in my voice
            </button>
            <button
              className="btn ghost"
              disabled={!aiConfigured || busy || !text.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await api.rewrite(text, 55);
                  setText(r.data.text);
                } catch (e) {
                  setErr(e instanceof Error ? e.message : "Rewrite failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Rewrite
            </button>
          </div>
          {!aiConfigured && <div className="empty">Add an LLM API key to unlock writing.</div>}
        </div>
      </div>
    </div>
  );
}

function Queue() {
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [filter, setFilter] = useState("");
  async function load() {
    const r = await api.posts(filter || undefined);
    setPosts(r.data);
  }
  useEffect(() => { load().catch(() => null); }, [filter]);
  return (
    <div>
      <h1 className="page-title">Queue</h1>
      <p className="page-sub">Drafts, scheduled, sent, and failed posts.</p>
      <div className="row" style={{ marginBottom: 12 }}>
        {["", "draft", "queued", "sent", "failed"].map((s) => (
          <button key={s || "all"} className={`btn ${filter === s ? "" : "secondary"}`} onClick={() => setFilter(s)}>
            {s || "all"}
          </button>
        ))}
        <button className="btn ghost" onClick={() => load()}>Refresh</button>
      </div>
      <div className="list">
        {posts.map((p) => (
          <div className="item" key={p.id}>
            <div>{p.text}</div>
            <div className="meta">{p.status} · {p.scheduled_for || p.published_at || p.created_at} {p.error ? `· ${p.error}` : ""}</div>
            <div className="row" style={{ marginTop: 8 }}>
              {p.status !== "sent" && (
                <button className="btn secondary" onClick={async () => { await api.publishPost(p.id); await load(); }}>Publish</button>
              )}
              <button className="btn danger" onClick={async () => { await api.deletePost(p.id); await load(); }}>Delete</button>
            </div>
          </div>
        ))}
        {!posts.length && <div className="empty">Queue empty.</div>}
      </div>
    </div>
  );
}

function AiStudio({ aiConfigured }: { aiConfigured: boolean }) {
  const [brief, setBrief] = useState("");
  const [parts, setParts] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [topic, setTopic] = useState("Ship notes + lessons");
  const [err, setErr] = useState("");

  async function refresh() {
    setSuggestions((await api.suggestions()).data);
    setWorkers((await api.workers()).data);
  }
  useEffect(() => { refresh().catch(() => null); }, []);

  return (
    <div>
      <h1 className="page-title">AI Studio</h1>
      <p className="page-sub">Threads, workers, and review queue.</p>
      {!aiConfigured && <div className="error" style={{ marginBottom: 12 }}>Configure OPENAI_API_KEY or ANTHROPIC_API_KEY.</div>}
      <div className="grid-2">
        <div className="panel stack">
          <h3>Thread writer</h3>
          <textarea className="textarea" value={brief} onChange={(e) => setBrief(e.target.value)} />
          <button
            className="btn"
            disabled={!aiConfigured || !brief.trim()}
            onClick={async () => {
              try {
                setParts((await api.thread(brief, 6)).data.parts);
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Failed");
              }
            }}
          >
            Generate thread
          </button>
          {parts.map((p, i) => (
            <div className="item" key={i}><strong>{i + 1}.</strong> {p}</div>
          ))}
          {parts.length > 0 && (
            <button
              className="btn secondary"
              onClick={async () => {
                await api.createPost({ text: parts[0], parts, status: "draft" });
                setErr("");
                alert("Saved thread as draft");
              }}
            >
              Save as draft thread
            </button>
          )}
          {err && <div className="error">{err}</div>}
        </div>
        <div className="panel stack">
          <h3>Content workers</h3>
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic source" />
          <button
            className="btn secondary"
            onClick={async () => {
              await api.createWorker({ name: "Daily batch", topic_source: topic, batch_size: 3 });
              await refresh();
            }}
          >
            Create worker
          </button>
          {workers.map((w) => (
            <div className="item" key={w.id}>
              {w.name}
              <div className="meta">{w.topic_source}</div>
              <button className="btn ghost" onClick={async () => { await api.runWorker(w.id); await refresh(); }}>Run now</button>
            </div>
          ))}
          <h3>To review</h3>
          {suggestions.map((s) => (
            <div className="item" key={s.id}>
              {s.text}
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn secondary" onClick={async () => { await api.draftSuggestion(s.id); await refresh(); }}>Save draft</button>
                <button className="btn ghost" onClick={async () => { await api.dismissSuggestion(s.id); await refresh(); }}>Dismiss</button>
              </div>
            </div>
          ))}
          {!suggestions.length && <div className="empty">No suggestions waiting.</div>}
        </div>
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <button className="btn ghost" disabled={!aiConfigured} onClick={() => api.styleGuide()}>Rebuild style guide from my posts</button>
      </div>
    </div>
  );
}

function Analytics() {
  const [data, setData] = useState<any>(null);
  async function load() {
    setData((await api.analytics()).data);
  }
  useEffect(() => { load().catch(() => null); }, []);
  const totals = data?.totals || {};
  return (
    <div>
      <h1 className="page-title">Analytics</h1>
      <p className="page-sub">Synced from your X posts.</p>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn" onClick={async () => { await api.syncAnalytics(); alert("Sync queued"); }}>Sync now</button>
        <button className="btn secondary" onClick={() => load()}>Refresh</button>
      </div>
      <div className="stat-row" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="n">{totals.posts || 0}</div><div className="l">Posts</div></div>
        <div className="stat"><div className="n">{totals.impressions || 0}</div><div className="l">Impressions</div></div>
        <div className="stat"><div className="n">{totals.likes || 0}</div><div className="l">Likes</div></div>
        <div className="stat"><div className="n">{totals.replies || 0}</div><div className="l">Replies</div></div>
      </div>
      <div className="grid-2">
        <div className="panel">
          <h3>Top posts</h3>
          <div className="list">
            {(data?.top || []).map((p: any) => (
              <div className="item" key={p.id}>{p.text}<div className="meta">{p.impressions} imp · {p.likes} likes</div></div>
            ))}
          </div>
        </div>
        <div className="panel">
          <h3>Needs work</h3>
          <div className="list">
            {(data?.worst || []).map((p: any) => (
              <div className="item" key={p.id}>{p.text}<div className="meta">{p.impressions} imp · {p.likes} likes</div></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Engage() {
  const [feeds, setFeeds] = useState<any[]>([]);
  const [name, setName] = useState("Niche chat");
  const [keywords, setKeywords] = useState("indie hackers OR build in public");
  const [posts, setPosts] = useState<any[]>([]);
  const [active, setActive] = useState<string>("");
  const [reply, setReply] = useState("");

  async function refresh() {
    setFeeds((await api.feeds()).data);
  }
  useEffect(() => { refresh().catch(() => null); }, []);

  return (
    <div>
      <h1 className="page-title">Engage</h1>
      <p className="page-sub">Find conversations worth joining, draft replies in your voice.</p>
      <div className="panel stack" style={{ marginBottom: 16 }}>
        <div className="row">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Feed name" />
          <input className="input" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="keywords" />
          <button
            className="btn"
            onClick={async () => {
              await api.createFeed({ name, keywords: keywords.split(/\s+OR\s+|,/).map((s) => s.trim()).filter(Boolean) });
              await refresh();
            }}
          >
            Add feed
          </button>
        </div>
        <div className="row">
          {feeds.map((f) => (
            <button
              key={f.id}
              className={`btn ${active === f.id ? "" : "secondary"}`}
              onClick={async () => {
                setActive(f.id);
                setPosts((await api.feedPosts(f.id)).data);
              }}
            >
              {f.name}
            </button>
          ))}
        </div>
      </div>
      <div className="list">
        {posts.map((p) => (
          <div className="item" key={p.id}>
            <div className="meta">@{p.author?.username} · {p.metrics?.like_count || 0} likes</div>
            <div>{p.text}</div>
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className="btn ghost"
                onClick={async () => {
                  const r = await api.reply(p.text, p.author?.username);
                  setReply(r.data.text);
                }}
              >
                Draft reply
              </button>
            </div>
          </div>
        ))}
      </div>
      {reply && (
        <div className="panel" style={{ marginTop: 12 }}>
          <h3>Reply draft</h3>
          <textarea className="textarea" value={reply} onChange={(e) => setReply(e.target.value)} />
          <button className="btn secondary" onClick={async () => { await api.createPost({ text: reply, status: "draft" }); alert("Saved reply draft"); }}>Save draft</button>
        </div>
      )}
    </div>
  );
}

function Signals() {
  const [agents, setAgents] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [name, setName] = useState("ICP hunters");
  const [icp, setIcp] = useState("Founders of B2B SaaS under 10k followers who post about distribution");
  const [keywords, setKeywords] = useState("looking for customers, indie hacker MRR, open to collab");

  async function refresh() {
    setAgents((await api.agents()).data);
    setLeads((await api.leads()).data);
  }
  useEffect(() => { refresh().catch(() => null); }, []);

  return (
    <div>
      <h1 className="page-title">Signal Agents</h1>
      <p className="page-sub">Watch keywords, score people against your ICP, collect leads.</p>
      <div className="panel stack" style={{ marginBottom: 16 }}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        <textarea className="textarea" value={icp} onChange={(e) => setIcp(e.target.value)} />
        <input className="input" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="comma-separated keywords" />
        <button
          className="btn"
          onClick={async () => {
            await api.createAgent({
              name,
              icp,
              keywords: keywords.split(",").map((s) => s.trim()).filter(Boolean),
            });
            await refresh();
          }}
        >
          Create agent
        </button>
      </div>
      <div className="grid-2">
        <div className="panel">
          <h3>Agents</h3>
          {agents.map((a) => (
            <div className="item" key={a.id}>
              {a.name} <span className="pill">{a.status}</span>
              <div className="meta">{a.icp_description}</div>
              <button className="btn ghost" onClick={async () => { await api.runAgent(a.id); alert("Run queued"); }}>Run</button>
            </div>
          ))}
        </div>
        <div className="panel">
          <h3>Leads</h3>
          {leads.map((l) => (
            <div className="item" key={l.id}>
              @{l.handle} · score {l.icp_score}
              <div className="meta">{l.icp_rationale}</div>
            </div>
          ))}
          {!leads.length && <div className="empty">No leads yet — run an agent after X is connected.</div>}
        </div>
      </div>
    </div>
  );
}

function Inspiration() {
  const [items, setItems] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [text, setText] = useState("");
  async function load(query?: string) {
    setItems((await api.inspiration(query)).data);
  }
  useEffect(() => { load().catch(() => null); }, []);
  return (
    <div>
      <h1 className="page-title">Inspiration</h1>
      <p className="page-sub">Your personal viral library — seed it, grow it, remix it.</p>
      <div className="row" style={{ marginBottom: 12 }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search or ingest query" />
        <button className="btn secondary" onClick={() => load(q)}>Search</button>
        <button className="btn" onClick={async () => { await api.ingestInspiration(q || "build in public"); alert("Ingest queued"); }}>Ingest from X</button>
      </div>
      <div className="panel stack" style={{ marginBottom: 16 }}>
        <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a viral post to save" />
        <button className="btn ghost" onClick={async () => { await api.addInspiration({ text }); setText(""); await load(q); }}>Save manually</button>
      </div>
      <div className="list">
        {items.map((i) => (
          <div className="item" key={i.id}>
            {i.text}
            <div className="meta">@{i.author_handle || "unknown"} · {i.likes} likes · {i.topic || i.source}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Audience() {
  const [contacts, setContacts] = useState<any[]>([]);
  const [lists, setLists] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [listName, setListName] = useState("");
  useEffect(() => {
    api.contacts().then((r) => setContacts(r.data)).catch(() => null);
    api.lists().then((r) => setLists(r.data)).catch(() => null);
  }, []);
  return (
    <div>
      <h1 className="page-title">Audience</h1>
      <p className="page-sub">Contacts, lists, and notes.</p>
      <div className="row" style={{ marginBottom: 12 }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts" />
        <button className="btn secondary" onClick={async () => setContacts((await api.contacts(q)).data)}>Search</button>
        <input className="input" style={{ maxWidth: 200 }} value={listName} onChange={(e) => setListName(e.target.value)} placeholder="New list" />
        <button className="btn ghost" onClick={async () => { await api.createList(listName); setLists((await api.lists()).data); }}>Create list</button>
      </div>
      <div className="grid-2">
        <div className="panel">
          <h3>Contacts</h3>
          {contacts.map((c) => (
            <div className="item" key={c.id}>@{c.handle}<div className="meta">{c.bio}</div></div>
          ))}
          {!contacts.length && <div className="empty">Contacts appear as you engage and collect leads.</div>}
        </div>
        <div className="panel">
          <h3>Lists</h3>
          {lists.map((l) => (
            <div className="item" key={l.id}>{l.name}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Automations() {
  const [plugs, setPlugs] = useState<any[]>([]);
  const [dms, setDms] = useState<any[]>([]);
  const [name, setName] = useState("CTA plug");
  const [body, setBody] = useState("If this resonated, I wrote more here: https://…");
  useEffect(() => {
    api.plugs().then((r) => setPlugs(r.data)).catch(() => null);
    api.dms().then((r) => setDms(r.data)).catch(() => null);
  }, []);
  return (
    <div>
      <h1 className="page-title">Automations</h1>
      <p className="page-sub">Auto-retweet / plug / delete attach on compose. DMs stay pending until you flush (safety).</p>
      <div className="grid-2">
        <div className="panel stack">
          <h3>Plug templates</h3>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          <textarea className="textarea" value={body} onChange={(e) => setBody(e.target.value)} />
          <button className="btn" onClick={async () => { await api.createPlug({ name, body }); setPlugs((await api.plugs()).data); }}>Save template</button>
          {plugs.map((p) => <div className="item" key={p.id}>{p.name}<div className="meta">{p.body}</div></div>)}
        </div>
        <div className="panel">
          <h3>DM queue</h3>
          {dms.map((d) => (
            <div className="item" key={d.id}>{d.status} → @{d.recipient_handle || d.recipient_x_user_id}<div className="meta">{d.body}</div></div>
          ))}
          {!dms.length && <div className="empty">No DMs queued.</div>}
        </div>
      </div>
    </div>
  );
}

function Articles() {
  const [items, setItems] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [md, setMd] = useState("");
  useEffect(() => { api.articles().then((r) => setItems(r.data)).catch(() => null); }, []);
  return (
    <div>
      <h1 className="page-title">Articles</h1>
      <p className="page-sub">Long-form drafts (publish to X Articles requires Premium + X write path).</p>
      <div className="panel stack" style={{ marginBottom: 16 }}>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
        <textarea className="textarea" value={md} onChange={(e) => setMd(e.target.value)} placeholder="Markdown body" />
        <button
          className="btn"
          onClick={async () => {
            await api.createArticle({ title, content_markdown: md });
            setItems((await api.articles()).data);
            setTitle(""); setMd("");
          }}
        >
          Save draft
        </button>
      </div>
      <div className="list">
        {items.map((a) => (
          <div className="item" key={a.id}>{a.title}<div className="meta">{a.status}</div></div>
        ))}
      </div>
    </div>
  );
}

function Settings({
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
  const [profile, setProfile] = useState("");
  const [interests, setInterests] = useState("");
  const [rules, setRules] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [bskyHandle, setBskyHandle] = useState("");
  const [bskyPass, setBskyPass] = useState("");
  const [slots, setSlots] = useState('[{"time":"09:00","days":[1,2,3,4,5]},{"time":"17:00","days":[1,2,3,4,5]}]');
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.context().then((r) => {
      if (!r.data) return;
      setProfile(r.data.profile_description || "");
      try { setInterests(JSON.parse(r.data.interests_json || "[]").join(", ")); } catch { /* */ }
      try { setRules(JSON.parse(r.data.rules_json || "[]").join("\n")); } catch { /* */ }
    }).catch(() => null);
    api.queueSettings().then((r) => {
      if (r.data?.slots_json) setSlots(r.data.slots_json);
    }).catch(() => null);
    onRefresh();
  }, []);

  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">Accounts, voice context, queue slots, API keys.</p>
      <div className="panel" style={{ marginBottom: 16 }}>
        <h3>Accounts</h3>
        <div className="row">
          <span className={`pill ${xConfigured ? "ok" : "warn"}`}>X API {xConfigured ? "configured" : "missing secrets"}</span>
          <span className={`pill ${aiConfigured ? "ok" : "warn"}`}>AI {aiConfigured ? "configured" : "missing keys"}</span>
          {xConfigured && <a className="btn secondary" href="/oauth/x/start">Connect X</a>}
        </div>
        <div className="list" style={{ marginTop: 10 }}>
          {accounts.map((a) => (
            <div className="item" key={a.id}>@{a.handle} {a.is_main ? <span className="pill ok">main</span> : null}</div>
          ))}
        </div>
      </div>
      <div className="grid-2">
        <div className="panel stack">
          <h3>Voice / context</h3>
          <textarea className="textarea" value={profile} onChange={(e) => setProfile(e.target.value)} placeholder="Who you are / what you build" />
          <input className="input" value={interests} onChange={(e) => setInterests(e.target.value)} placeholder="Interests, comma-separated" />
          <textarea className="textarea" value={rules} onChange={(e) => setRules(e.target.value)} placeholder="Hard rules, one per line" />
          <button
            className="btn"
            onClick={async () => {
              await api.saveContext({
                profile_description: profile,
                interests: interests.split(",").map((s) => s.trim()).filter(Boolean),
                rules: rules.split("\n").map((s) => s.trim()).filter(Boolean),
              });
              setMsg("Context saved");
            }}
          >
            Save context
          </button>
        </div>
        <div className="panel stack">
          <h3>Queue slots (JSON)</h3>
          <textarea className="textarea" value={slots} onChange={(e) => setSlots(e.target.value)} />
          <button
            className="btn secondary"
            onClick={async () => {
              await api.saveQueueSettings({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, slots: JSON.parse(slots) });
              setMsg("Queue settings saved");
            }}
          >
            Save slots
          </button>
          <h3>API key for CLI / MCP</h3>
          <button
            className="btn ghost"
            onClick={async () => {
              const r = await api.createApiKey("cli");
              setApiKey(r.key);
            }}
          >
            Create API key
          </button>
          {apiKey && <div className="item"><code>{apiKey}</code><div className="meta">Copy now — shown once.</div></div>}
          <h3>Bluesky</h3>
          <input className="input" value={bskyHandle} onChange={(e) => setBskyHandle(e.target.value)} placeholder="handle.bsky.social" />
          <input className="input" type="password" value={bskyPass} onChange={(e) => setBskyPass(e.target.value)} placeholder="app password" />
          <button className="btn ghost" onClick={async () => { await api.connectBluesky(bskyHandle, bskyPass); setMsg("Bluesky connected"); }}>Connect Bluesky</button>
        </div>
      </div>
      {msg && <div className="success" style={{ marginTop: 12 }}>{msg}</div>}
    </div>
  );
}
