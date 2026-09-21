import { Hono } from "hono";
import type { Env, JobMessage } from "./env";
import { authRoutes } from "./routes/auth";
import { oauthRoutes, accountRoutes } from "./routes/oauth";
import { postsRoutes } from "./routes/posts";
import {
  aiRoutes,
  analyticsRoutes,
  contextRoutes,
  engageRoutes,
  signalRoutes,
  syncAnalytics,
} from "./routes/ai-analytics";
import {
  articleRoutes,
  audienceRoutes,
  blueskyRoutes,
  dmRoutes,
  inspirationRoutes,
  mediaRoutes,
  plugRoutes,
  queueSettingsRoutes,
  usageRoutes,
  workerRoutes,
} from "./routes/rest";
import { enqueueDueAutomations, enqueueDuePosts, publishScheduledPost, runDueAutomations, getAccount } from "./services/posts";
import { runSignalAgent, writeDraft } from "./services/ai-content";
import { getValidAccessToken, searchRecent, sendDm } from "./lib/x";
import { id } from "./lib/crypto";
import { logUsage } from "./lib/ai";
import { ensureDefaultUser } from "./lib/auth";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", async (c, next) => {
  await ensureDefaultUser(c.env.DB);
  c.header("Access-Control-Allow-Origin", c.env.APP_URL || "*");
  c.header("Access-Control-Allow-Credentials", "true");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  c.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await next();
});

app.route("/api/auth", authRoutes);
app.route("/oauth", oauthRoutes);
app.route("/api/accounts", accountRoutes);
app.route("/api/posts", postsRoutes);
app.route("/api/ai", aiRoutes);
app.route("/api/context", contextRoutes);
app.route("/api/analytics", analyticsRoutes);
app.route("/api/engage", engageRoutes);
app.route("/api/signals", signalRoutes);
app.route("/api/audience", audienceRoutes);
app.route("/api/inspiration", inspirationRoutes);
app.route("/api/dms", dmRoutes);
app.route("/api/articles", articleRoutes);
app.route("/api/media", mediaRoutes);
app.route("/api/plugs", plugRoutes);
app.route("/api/workers", workerRoutes);
app.route("/api/bluesky", blueskyRoutes);
app.route("/api/usage", usageRoutes);
app.route("/api/queue-settings", queueSettingsRoutes);

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    name: c.env.APP_NAME || "GrowLab",
    time: new Date().toISOString(),
  }),
);

// Secure redeploy helper: PUT body to R2 for later promotion via CI/API
app.put("/__deploy", async (c) => {
  const secret = c.req.header("x-deploy-secret");
  if (!c.env.DEPLOY_SECRET || secret !== c.env.DEPLOY_SECRET) {
    return c.text("unauthorized", 401);
  }
  const key = c.req.query("key");
  if (!key) return c.text("key required", 400);
  const bytes = await c.req.arrayBuffer();
  await c.env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: c.req.header("content-type") || "application/octet-stream" },
  });
  return c.json({ ok: true, key, bytes: bytes.byteLength });
});

app.get("/api/me", async (c) => {
  const { requireAuth } = await import("./lib/auth");
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accounts = await c.env.DB.prepare(
    `SELECT id, handle, display_name, avatar_url, is_main FROM x_accounts WHERE user_id = ?`,
  )
    .bind(user)
    .all();
  return c.json({
    data: {
      user_id: user,
      accounts: accounts.results || [],
      x_configured: Boolean(c.env.X_CLIENT_ID && c.env.X_CLIENT_SECRET),
      oauth1_configured: Boolean(c.env.X_API_KEY && c.env.X_API_SECRET),
      ai_configured: Boolean(c.env.OPENAI_API_KEY || c.env.ANTHROPIC_API_KEY),
    },
  });
});

async function handleJob(env: Env, msg: JobMessage) {
  switch (msg.type) {
    case "publish_post":
      await publishScheduledPost(env, msg.postId);
      break;
    case "run_automations":
      await runDueAutomations(env);
      break;
    case "sync_analytics":
      await syncAnalytics(env, msg.accountId);
      break;
    case "run_signal_agent":
      await runSignalAgent(env, msg.agentId);
      break;
    case "send_dm": {
      const dm = await env.DB.prepare(`SELECT * FROM dm_queue WHERE id = ?`)
        .bind(msg.dmId)
        .first<{
          id: string;
          account_id: string;
          recipient_x_user_id: string;
          body: string;
          status: string;
        }>();
      if (!dm || dm.status !== "pending") break;
      await env.DB.prepare(`UPDATE dm_queue SET status = 'sending' WHERE id = ?`).bind(dm.id).run();
      try {
        const account = await getAccount(env.DB, dm.account_id);
        if (!account) throw new Error("no account");
        const token = await getValidAccessToken(env, account);
        await sendDm(env, token, dm.recipient_x_user_id, dm.body);
        await env.DB.prepare(
          `UPDATE dm_queue SET status = 'sent', sent_at = datetime('now') WHERE id = ?`,
        )
          .bind(dm.id)
          .run();
        await logUsage(env.DB, "dm", 0, dm.account_id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await env.DB.prepare(`UPDATE dm_queue SET status = 'failed', error = ? WHERE id = ?`)
          .bind(message.slice(0, 1000), dm.id)
          .run();
      }
      break;
    }
    case "run_content_worker": {
      const worker = await env.DB.prepare(`SELECT * FROM content_workers WHERE id = ?`)
        .bind(msg.workerId)
        .first<{ id: string; account_id: string; topic_source: string | null; batch_size: number }>();
      if (!worker) break;
      for (let i = 0; i < (worker.batch_size || 3); i++) {
        const brief =
          worker.topic_source ||
          "Write a high-signal post for today based on my niche and recent style.";
        const text = await writeDraft(env, worker.account_id, brief);
        await env.DB.prepare(
          `INSERT INTO ai_suggestions (id, account_id, worker_id, text, status) VALUES (?, ?, ?, ?, 'to_review')`,
        )
          .bind(id("sug"), worker.account_id, worker.id, text)
          .run();
      }
      await env.DB.prepare(
        `UPDATE content_workers SET next_run_at = datetime('now', '+1 day') WHERE id = ?`,
      )
        .bind(worker.id)
        .run();
      break;
    }
    case "ingest_inspiration": {
      const account = await getAccount(env.DB, msg.accountId);
      if (!account) break;
      const token = await getValidAccessToken(env, account);
      const results = await searchRecent(env, token, `${msg.query} min_faves:50 -is:retweet`, 30);
      const users = new Map((results.includes?.users || []).map((u) => [u.id, u]));
      for (const t of results.data || []) {
        const author = users.get(t.author_id);
        await env.DB.prepare(
          `INSERT INTO inspiration_posts (id, x_post_id, author_handle, text, likes, replies, reposts, impressions, topic, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ingest')`,
        )
          .bind(
            id("insp"),
            t.id,
            author?.username || null,
            t.text,
            t.public_metrics?.like_count ?? 0,
            t.public_metrics?.reply_count ?? 0,
            t.public_metrics?.retweet_count ?? 0,
            t.public_metrics?.impression_count ?? 0,
            msg.query,
          )
          .run();
      }
      break;
    }
    default: {
      const _exhaustive: never = msg;
      void _exhaustive;
    }
  }
}

async function runCron(env: Env) {
  const published = await enqueueDuePosts(env);
  await enqueueDueAutomations(env);

  const workers = await env.DB.prepare(
    `SELECT id FROM content_workers WHERE enabled = 1 AND (next_run_at IS NULL OR next_run_at <= datetime('now')) LIMIT 5`,
  ).all<{ id: string }>();
  for (const w of workers.results || []) {
    await env.JOBS.send({ type: "run_content_worker", workerId: w.id });
  }

  const last = await env.KV.get("signals:last_run");
  if (!last || Date.now() - Number(last) > 30 * 60_000) {
    await env.KV.put("signals:last_run", String(Date.now()));
    const agents = await env.DB.prepare(
      `SELECT id FROM signal_agents WHERE status = 'active' LIMIT 5`,
    ).all<{ id: string }>();
    for (const a of agents.results || []) {
      await env.JOBS.send({ type: "run_signal_agent", agentId: a.id });
    }
  }

  return { published };
}

async function serveSite(env: Env, pathname: string): Promise<Response> {
  const prefix = (env.SITE_PREFIX || "site").replace(/\/$/, "");
  let key = pathname === "/" ? `${prefix}/index.html` : `${prefix}${pathname}`;
  let obj = await env.MEDIA.get(key);
  if (!obj && !pathname.includes(".")) {
    obj = await env.MEDIA.get(`${prefix}/index.html`);
    key = `${prefix}/index.html`;
  }
  if (!obj) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (key.endsWith(".html")) headers.set("content-type", "text/html; charset=utf-8");
  if (key.endsWith(".js")) headers.set("content-type", "application/javascript; charset=utf-8");
  if (key.endsWith(".css")) headers.set("content-type", "text/css; charset=utf-8");
  headers.set("cache-control", key.endsWith(".html") ? "no-cache" : "public, max-age=86400");
  return new Response(obj.body, { headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (
      url.pathname.startsWith("/api") ||
      url.pathname.startsWith("/oauth") ||
      url.pathname === "/__deploy"
    ) {
      return app.fetch(request, env, ctx);
    }
    return serveSite(env, url.pathname);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runCron(env));
  },

  async queue(batch: MessageBatch<JobMessage>, env: Env) {
    for (const message of batch.messages) {
      try {
        await handleJob(env, message.body);
        message.ack();
      } catch (err) {
        console.error("job failed", message.body, err);
        message.retry();
      }
    }
  },
};
