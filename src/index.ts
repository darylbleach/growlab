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
