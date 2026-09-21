import { Hono } from "hono";
import type { Env } from "../env";
import { requireAuth } from "../lib/auth";
import { id } from "../lib/crypto";
import { aiConfigured } from "../lib/ai";
import {
  draftReply,
  rebuildStyleGuide,
  rewriteDraft,
  scoreDraft,
  writeDraft,
  writeThread,
} from "../services/ai-content";
import { getMainAccount } from "../services/posts";
import {
  getValidAccessToken,
  listUserTweets,
  searchRecent,
} from "../lib/x";
import { getAccount } from "../services/posts";
import { logUsage } from "../lib/ai";

async function accountIdOrMain(c: any, userId: string) {
  const fromQuery = c.req.query("account_id");
  if (fromQuery) return fromQuery;
  const main = await getMainAccount(c.env.DB, userId);
  if (main?.id) return main.id;

  // Seed a local stub so AI writers work before Connect X
  const stubId = id("acc");
  await c.env.DB.prepare(
    `INSERT INTO x_accounts (id, user_id, x_user_id, handle, display_name, access_token_enc, refresh_token_enc, scopes, is_main)
     VALUES (?, ?, 'local', 'local', 'Local draft account', '', NULL, 'local', 1)`,
  )
    .bind(stubId, userId)
    .run();
  await c.env.DB.prepare(`INSERT OR IGNORE INTO context_settings (account_id) VALUES (?)`)
    .bind(stubId)
    .run();
  await c.env.DB.prepare(`INSERT OR IGNORE INTO queue_settings (account_id) VALUES (?)`)
    .bind(stubId)
    .run();
  return stubId;
}

export const aiRoutes = new Hono<{ Bindings: Env }>();

aiRoutes.post("/write", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  if (!aiConfigured(c.env)) {
    return c.json({ error: { code: "ai_not_configured", message: "Set OPENAI_API_KEY or ANTHROPIC_API_KEY" } }, 400);
  }
  try {
    const accountId = await accountIdOrMain(c, user);
    if (!accountId) return c.json({ error: { code: "no_account" } }, 400);
    const body = await c.req.json<{ brief: string }>();
    const text = await writeDraft(c.env, accountId, body.brief);
    return c.json({ data: { text } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: { code: "ai_failed", message } }, 502);
  }
});

aiRoutes.post("/rewrite", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  if (!aiConfigured(c.env)) return c.json({ error: { code: "ai_not_configured" } }, 400);
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ error: { code: "no_account" } }, 400);
  const body = await c.req.json<{ text: string; closeness?: number; instruction?: string }>();
  const text = await rewriteDraft(c.env, accountId, body.text, body.closeness ?? 50, body.instruction);
  return c.json({ data: { text } });
});

aiRoutes.post("/thread", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  if (!aiConfigured(c.env)) return c.json({ error: { code: "ai_not_configured" } }, 400);
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ error: { code: "no_account" } }, 400);
  const body = await c.req.json<{ brief: string; parts?: number }>();
  const parts = await writeThread(c.env, accountId, body.brief, body.parts ?? 5);
  return c.json({ data: { parts } });
});

aiRoutes.post("/reply", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  if (!aiConfigured(c.env)) return c.json({ error: { code: "ai_not_configured" } }, 400);
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ error: { code: "no_account" } }, 400);
  const body = await c.req.json<{ text: string; author?: string }>();
  const text = await draftReply(c.env, accountId, body.text, body.author);
  return c.json({ data: { text } });
});

aiRoutes.post("/score", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  if (!aiConfigured(c.env)) return c.json({ error: { code: "ai_not_configured" } }, 400);
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ error: { code: "no_account" } }, 400);
  const body = await c.req.json<{ text: string }>();
  const score = await scoreDraft(c.env, accountId, body.text);
  return c.json({ data: score });
});

aiRoutes.post("/style-guide", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  if (!aiConfigured(c.env)) return c.json({ error: { code: "ai_not_configured" } }, 400);
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ error: { code: "no_account" } }, 400);
  const guide = await rebuildStyleGuide(c.env, accountId);
  return c.json({ data: { style_guide: guide } });
});

export const contextRoutes = new Hono<{ Bindings: Env }>();

contextRoutes.get("/", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ data: null });
  const row = await c.env.DB.prepare(`SELECT * FROM context_settings WHERE account_id = ?`)
    .bind(accountId)
    .first();
  return c.json({ data: row });
});

contextRoutes.put("/", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ error: { code: "no_account" } }, 400);
  const body = await c.req.json<{
    profile_description?: string;
    interests?: string[];
    rules?: string[];
    style_guide_override?: string | null;
    favorite_creators?: string[];
    products?: unknown[];
  }>();
  await c.env.DB.prepare(
    `INSERT INTO context_settings (account_id, profile_description, interests_json, rules_json, style_guide_override, favorite_creators_json, products_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(account_id) DO UPDATE SET
       profile_description = COALESCE(excluded.profile_description, context_settings.profile_description),
       interests_json = COALESCE(excluded.interests_json, context_settings.interests_json),
       rules_json = COALESCE(excluded.rules_json, context_settings.rules_json),
       style_guide_override = excluded.style_guide_override,
       favorite_creators_json = COALESCE(excluded.favorite_creators_json, context_settings.favorite_creators_json),
       products_json = COALESCE(excluded.products_json, context_settings.products_json),
       updated_at = datetime('now')`,
  )
    .bind(
      accountId,
      body.profile_description ?? null,
      body.interests ? JSON.stringify(body.interests) : "[]",
      body.rules ? JSON.stringify(body.rules) : "[]",
      body.style_guide_override ?? null,
      body.favorite_creators ? JSON.stringify(body.favorite_creators) : "[]",
      body.products ? JSON.stringify(body.products) : "[]",
    )
    .run();
  const row = await c.env.DB.prepare(`SELECT * FROM context_settings WHERE account_id = ?`)
    .bind(accountId)
    .first();
  return c.json({ data: row });
});

export const analyticsRoutes = new Hono<{ Bindings: Env }>();

analyticsRoutes.post("/sync", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ error: { code: "no_account" } }, 400);
  await c.env.JOBS.send({ type: "sync_analytics", accountId });
  return c.json({ ok: true, queued: true });
});

analyticsRoutes.get("/", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ data: { totals: {}, series: [], top: [], worst: [] } });

  const totals = await c.env.DB.prepare(
    `SELECT
      COUNT(*) as posts,
      COALESCE(SUM(likes),0) as likes,
      COALESCE(SUM(replies),0) as replies,
      COALESCE(SUM(reposts),0) as reposts,
      COALESCE(SUM(impressions),0) as impressions
     FROM posts_cache WHERE account_id = ? AND is_reply = 0`,
  )
    .bind(accountId)
    .first();

  const series = await c.env.DB.prepare(
    `SELECT * FROM metrics_daily WHERE account_id = ? ORDER BY day DESC LIMIT 30`,
  )
    .bind(accountId)
    .all();

  const top = await c.env.DB.prepare(
    `SELECT * FROM posts_cache WHERE account_id = ? AND is_reply = 0 ORDER BY impressions DESC, likes DESC LIMIT 10`,
  )
    .bind(accountId)
    .all();

  const worst = await c.env.DB.prepare(
    `SELECT * FROM posts_cache WHERE account_id = ? AND is_reply = 0 ORDER BY impressions ASC, likes ASC LIMIT 10`,
  )
    .bind(accountId)
    .all();

  return c.json({
    data: {
      totals,
      series: (series.results || []).reverse(),
      top: top.results || [],
      worst: worst.results || [],
    },
  });
});

export async function syncAnalytics(env: Env, accountId: string) {
  const account = await getAccount(env.DB, accountId);
  if (!account) return;
  const token = await getValidAccessToken(env, account);
  const tweets = await listUserTweets(env, token, account.x_user_id, 100);
  for (const t of tweets.data || []) {
    const m = t.public_metrics;
    await env.DB.prepare(
      `INSERT INTO posts_cache (id, account_id, text, created_at_x, likes, replies, reposts, quotes, impressions, bookmarks, is_reply, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         likes = excluded.likes, replies = excluded.replies, reposts = excluded.reposts,
         quotes = excluded.quotes, impressions = excluded.impressions, bookmarks = excluded.bookmarks,
         synced_at = datetime('now')`,
    )
      .bind(
        t.id,
        accountId,
        t.text,
        t.created_at || null,
        m?.like_count ?? 0,
        m?.reply_count ?? 0,
        m?.retweet_count ?? 0,
        m?.quote_count ?? 0,
        m?.impression_count ?? 0,
        m?.bookmark_count ?? 0,
        t.in_reply_to_user_id ? 1 : 0,
      )
      .run();
    await logUsage(env.DB, "x_read", 0.005, accountId);
  }

  // rollup today
  const day = new Date().toISOString().slice(0, 10);
  const roll = await env.DB.prepare(
    `SELECT COUNT(*) as posts, COALESCE(SUM(likes),0) as likes, COALESCE(SUM(replies+reposts+quotes),0) as engagements, COALESCE(SUM(impressions),0) as impressions
     FROM posts_cache WHERE account_id = ? AND date(created_at_x) = ?`,
  )
    .bind(accountId, day)
    .first<{ posts: number; likes: number; engagements: number; impressions: number }>();

  await env.DB.prepare(
    `INSERT INTO metrics_daily (id, account_id, day, posts, likes, engagements, impressions)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, day) DO UPDATE SET
       posts = excluded.posts, likes = excluded.likes, engagements = excluded.engagements, impressions = excluded.impressions`,
  )
    .bind(`${accountId}:${day}`, accountId, day, roll?.posts ?? 0, roll?.likes ?? 0, roll?.engagements ?? 0, roll?.impressions ?? 0)
    .run();
}

export const engageRoutes = new Hono<{ Bindings: Env }>();

engageRoutes.get("/feeds", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ data: [] });
  const rows = await c.env.DB.prepare(`SELECT * FROM engage_feeds WHERE account_id = ? ORDER BY created_at DESC`)
    .bind(accountId)
    .all();
  return c.json({ data: rows.results || [] });
});

engageRoutes.post("/feeds", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ error: { code: "no_account" } }, 400);
  const body = await c.req.json<{ name: string; keywords?: string[]; x_list_id?: string; contact_list_id?: string }>();
  const feedId = id("feed");
  await c.env.DB.prepare(
    `INSERT INTO engage_feeds (id, account_id, name, keywords_json, x_list_id, contact_list_id) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      feedId,
      accountId,
      body.name,
      body.keywords ? JSON.stringify(body.keywords) : null,
      body.x_list_id || null,
      body.contact_list_id || null,
    )
    .run();
  return c.json({ data: { id: feedId } }, 201);
});

engageRoutes.delete("/feeds/:id", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  await c.env.DB.prepare(`DELETE FROM engage_feeds WHERE id = ?`).bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

engageRoutes.get("/feeds/:id/posts", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const feed = await c.env.DB.prepare(`SELECT * FROM engage_feeds WHERE id = ?`)
    .bind(c.req.param("id"))
    .first<{ account_id: string; keywords_json: string | null }>();
  if (!feed) return c.json({ error: { code: "not_found" } }, 404);
  const account = await getAccount(c.env.DB, feed.account_id);
  if (!account) return c.json({ data: [] });
  const token = await getValidAccessToken(c.env, account);
  const keywords = feed.keywords_json ? (JSON.parse(feed.keywords_json) as string[]) : [];
  const query = keywords.length ? keywords.map((k) => `(${k})`).join(" OR ") : "min_faves:20 -is:retweet lang:en";
  const results = await searchRecent(c.env, token, query, 20);
  await logUsage(c.env.DB, "x_read", 0.005 * (results.data?.length || 1), feed.account_id);
  const users = new Map((results.includes?.users || []).map((u) => [u.id, u]));
  const data = (results.data || []).map((t) => ({
    id: t.id,
    text: t.text,
    metrics: t.public_metrics,
    author: users.get(t.author_id) || null,
  }));
  return c.json({ data });
});

export const signalRoutes = new Hono<{ Bindings: Env }>();

signalRoutes.get("/agents", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ data: [] });
  const agents = await c.env.DB.prepare(`SELECT * FROM signal_agents WHERE account_id = ? ORDER BY created_at DESC`)
    .bind(accountId)
    .all();
  const watches = await c.env.DB.prepare(
    `SELECT * FROM signal_watches WHERE agent_id IN (SELECT id FROM signal_agents WHERE account_id = ?)`,
  )
    .bind(accountId)
    .all();
  return c.json({ data: agents.results || [], watches: watches.results || [] });
});

signalRoutes.post("/agents", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ error: { code: "no_account" } }, 400);
  const body = await c.req.json<{ name: string; icp: string; keywords?: string[]; precision?: string }>();
  const agentId = id("agent");
  const listId = id("list");
  await c.env.DB.prepare(
    `INSERT INTO contact_lists (id, account_id, name) VALUES (?, ?, ?)`,
  )
    .bind(listId, accountId, `Leads: ${body.name}`)
    .run();
  await c.env.DB.prepare(
    `INSERT INTO signal_agents (id, account_id, name, icp_description, precision_mode, destination_list_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(agentId, accountId, body.name, body.icp, body.precision || "high", listId)
    .run();
  const keywords = body.keywords?.length ? body.keywords : [body.icp.split(/\s+/).slice(0, 4).join(" ")];
  for (const kw of keywords.slice(0, 5)) {
    await c.env.DB.prepare(
      `INSERT INTO signal_watches (id, agent_id, kind, value) VALUES (?, ?, 'keyword_watch', ?)`,
    )
      .bind(id("watch"), agentId, kw)
      .run();
  }
  await c.env.JOBS.send({ type: "run_signal_agent", agentId });
  return c.json({ data: { id: agentId, destination_list_id: listId } }, 201);
});

signalRoutes.post("/agents/:id/run", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  await c.env.JOBS.send({ type: "run_signal_agent", agentId: c.req.param("id") });
  return c.json({ ok: true, queued: true });
});

signalRoutes.post("/agents/:id/status", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const body = await c.req.json<{ status: "active" | "paused" }>();
  await c.env.DB.prepare(`UPDATE signal_agents SET status = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(body.status, c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

signalRoutes.delete("/agents/:id", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  await c.env.DB.prepare(`DELETE FROM signal_agents WHERE id = ?`).bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

signalRoutes.get("/leads", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ data: [] });
  const agentId = c.req.query("agent");
  let sql = `SELECT * FROM signal_leads WHERE account_id = ?`;
  const binds: string[] = [accountId];
  if (agentId) {
    sql += ` AND agent_id = ?`;
    binds.push(agentId);
  }
  sql += ` ORDER BY discovered_at DESC LIMIT 100`;
  const rows = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ data: rows.results || [] });
});
