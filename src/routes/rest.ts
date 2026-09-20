import { Hono } from "hono";
import type { Env } from "../env";
import { requireAuth } from "../lib/auth";
import { encryptText, id } from "../lib/crypto";
import { getMainAccount } from "../services/posts";
import { chat, aiConfigured, logUsage } from "../lib/ai";

async function accountIdOrMain(c: any, userId: string) {
  return c.req.query("account_id") || (await getMainAccount(c.env.DB, userId))?.id || null;
}

export const audienceRoutes = new Hono<{ Bindings: Env }>();

audienceRoutes.get("/contacts", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ data: [] });
  const q = c.req.query("q");
  let sql = `SELECT * FROM contacts WHERE account_id = ?`;
  const binds: string[] = [accountId];
  if (q) {
    sql += ` AND (handle LIKE ? OR display_name LIKE ?)`;
    binds.push(`%${q}%`, `%${q}%`);
  }
  sql += ` ORDER BY last_seen_at DESC LIMIT 100`;
  const rows = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ data: rows.results || [] });
});

audienceRoutes.get("/lists", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ data: [] });
  const rows = await c.env.DB.prepare(`SELECT * FROM contact_lists WHERE account_id = ? ORDER BY created_at DESC`)
    .bind(accountId)
    .all();
  return c.json({ data: rows.results || [] });
});

audienceRoutes.post("/lists", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ error: { code: "no_account" } }, 400);
  const body = await c.req.json<{ name: string }>();
  const listId = id("list");
  await c.env.DB.prepare(`INSERT INTO contact_lists (id, account_id, name) VALUES (?, ?, ?)`)
    .bind(listId, accountId, body.name)
    .run();
  return c.json({ data: { id: listId } }, 201);
});

audienceRoutes.post("/lists/:id/members", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const body = await c.req.json<{ contact_id: string }>();
  const memberId = id("mem");
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO contact_list_members (id, list_id, contact_id) VALUES (?, ?, ?)`,
  )
    .bind(memberId, c.req.param("id"), body.contact_id)
    .run();
  return c.json({ ok: true });
});

audienceRoutes.post("/contacts/:id/notes", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ error: { code: "no_account" } }, 400);
  const body = await c.req.json<{ body: string }>();
  const noteId = id("note");
  await c.env.DB.prepare(
    `INSERT INTO contact_notes (id, contact_id, account_id, body) VALUES (?, ?, ?, ?)`,
  )
    .bind(noteId, c.req.param("id"), accountId, body.body)
    .run();
  return c.json({ data: { id: noteId } }, 201);
});

export const inspirationRoutes = new Hono<{ Bindings: Env }>();

inspirationRoutes.get("/", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const q = c.req.query("q");
  const niche = c.req.query("niche");
  let sql = `SELECT * FROM inspiration_posts WHERE 1=1`;
  const binds: string[] = [];
  if (q) {
    sql += ` AND text LIKE ?`;
    binds.push(`%${q}%`);
  }
  if (niche) {
    sql += ` AND niche = ?`;
    binds.push(niche);
  }
  sql += ` ORDER BY likes DESC, created_at DESC LIMIT 50`;
  const rows = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ data: rows.results || [] });
});

inspirationRoutes.post("/", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const body = await c.req.json<{
    text: string;
    author_handle?: string;
    likes?: number;
    topic?: string;
    niche?: string;
    x_post_id?: string;
  }>();
  const postId = id("insp");
  await c.env.DB.prepare(
    `INSERT INTO inspiration_posts (id, x_post_id, author_handle, text, likes, topic, niche, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'manual')`,
  )
    .bind(
      postId,
      body.x_post_id || null,
      body.author_handle || null,
      body.text,
      body.likes ?? 0,
      body.topic || null,
      body.niche || null,
    )
    .run();
  return c.json({ data: { id: postId } }, 201);
});

inspirationRoutes.post("/ingest", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ error: { code: "no_account" } }, 400);
  const body = await c.req.json<{ query: string }>();
  await c.env.JOBS.send({ type: "ingest_inspiration", accountId, query: body.query });
  return c.json({ ok: true, queued: true });
});

export const dmRoutes = new Hono<{ Bindings: Env }>();

dmRoutes.get("/queue", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ data: [] });
  const rows = await c.env.DB.prepare(
    `SELECT * FROM dm_queue WHERE account_id = ? ORDER BY created_at DESC LIMIT 100`,
  )
    .bind(accountId)
    .all();
  return c.json({ data: rows.results || [] });
});

dmRoutes.post("/campaigns", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ error: { code: "no_account" } }, 400);
  const body = await c.req.json<{
    name?: string;
    messages: Array<{ recipient_x_user_id: string; recipient_handle?: string; body: string; scheduled_for?: string }>;
  }>();
  if (!body.messages?.length || body.messages.length > 100) {
    return c.json({ error: { code: "invalid", message: "1-100 messages required" } }, 400);
  }
  const campaignId = id("camp");
  await c.env.DB.prepare(`INSERT INTO dm_campaigns (id, account_id, name) VALUES (?, ?, ?)`)
    .bind(campaignId, accountId, body.name || "Campaign")
    .run();
  for (const msg of body.messages) {
    const dmId = id("dm");
    await c.env.DB.prepare(
      `INSERT INTO dm_queue (id, campaign_id, account_id, recipient_x_user_id, recipient_handle, body, status, scheduled_for)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
      .bind(
        dmId,
        campaignId,
        accountId,
        msg.recipient_x_user_id,
        msg.recipient_handle || null,
        msg.body,
        msg.scheduled_for || new Date().toISOString(),
      )
      .run();
    // Do NOT auto-send — safety. User must explicitly flush.
  }
  return c.json({ data: { id: campaignId, queued: body.messages.length, note: "DMs stay pending until you POST /api/dms/flush" } }, 201);
});

dmRoutes.post("/flush", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ error: { code: "no_account" } }, 400);
  const body = await c.req.json<{ confirm?: boolean; limit?: number }>().catch(() => ({ confirm: false }));
  if (!body.confirm) {
    return c.json({ error: { code: "confirm_required", message: "Pass { confirm: true } to send pending DMs" } }, 400);
  }
  const pending = await c.env.DB.prepare(
    `SELECT id FROM dm_queue WHERE account_id = ? AND status = 'pending' ORDER BY created_at ASC LIMIT ?`,
  )
    .bind(accountId, body.limit ?? 10)
    .all<{ id: string }>();
  for (const row of pending.results || []) {
    await c.env.JOBS.send({ type: "send_dm", dmId: row.id });
  }
  return c.json({ ok: true, queued: pending.results?.length || 0 });
});

dmRoutes.post("/campaigns/:id/cancel", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  await c.env.DB.prepare(
    `UPDATE dm_queue SET status = 'cancelled' WHERE campaign_id = ? AND status = 'pending'`,
  )
    .bind(c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

export const articleRoutes = new Hono<{ Bindings: Env }>();

articleRoutes.get("/", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ data: [] });
  const rows = await c.env.DB.prepare(
    `SELECT id, title, status, cover_url, scheduled_for, published_at, created_at, updated_at FROM articles WHERE account_id = ? ORDER BY updated_at DESC`,
  )
    .bind(accountId)
    .all();
  return c.json({ data: rows.results || [] });
});

articleRoutes.post("/", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ error: { code: "no_account" } }, 400);
  const body = await c.req.json<{ title: string; content_markdown: string }>();
  const articleId = id("art");
  await c.env.DB.prepare(
    `INSERT INTO articles (id, account_id, title, content_markdown) VALUES (?, ?, ?, ?)`,
  )
    .bind(articleId, accountId, body.title, body.content_markdown)
    .run();
  return c.json({ data: { id: articleId } }, 201);
});

articleRoutes.get("/:id", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const row = await c.env.DB.prepare(`SELECT * FROM articles WHERE id = ?`).bind(c.req.param("id")).first();
  if (!row) return c.json({ error: { code: "not_found" } }, 404);
  return c.json({ data: row });
});

articleRoutes.patch("/:id", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const body = await c.req.json<{
    title?: string;
    content_markdown?: string;
    cover_url?: string | null;
    scheduled_for?: string | null;
    status?: string;
  }>();
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const key of ["title", "content_markdown", "cover_url", "scheduled_for", "status"] as const) {
    if (key in body) {
      fields.push(`${key} = ?`);
      values.push(body[key]);
    }
  }
  if (!fields.length) return c.json({ error: { code: "empty" } }, 400);
  fields.push("updated_at = datetime('now')");
  values.push(c.req.param("id"));
  await c.env.DB.prepare(`UPDATE articles SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
  return c.json({ ok: true });
});

articleRoutes.post("/:id/cover", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  if (!aiConfigured(c.env) || !c.env.OPENAI_API_KEY) {
    return c.json({ error: { code: "openai_required", message: "Cover gen needs OPENAI_API_KEY" } }, 400);
  }
  const article = await c.env.DB.prepare(`SELECT * FROM articles WHERE id = ?`)
    .bind(c.req.param("id"))
    .first<{ id: string; title: string; account_id: string }>();
  if (!article) return c.json({ error: { code: "not_found" } }, 404);

  const prompt = await chat(c.env, [
    { role: "system", content: "Write a short image prompt for an article cover, 2.5:1 cinematic, no text in image." },
    { role: "user", content: `Article title: ${article.title}` },
  ]);

  const imgRes = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt,
      size: "1536x1024",
    }),
  });
  if (!imgRes.ok) {
    return c.json({ error: { code: "image_failed", message: await imgRes.text() } }, 500);
  }
  const imgJson = (await imgRes.json()) as { data: Array<{ b64_json?: string; url?: string }> };
  const b64 = imgJson.data[0]?.b64_json;
  let coverUrl = imgJson.data[0]?.url || null;
  if (b64) {
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const key = `covers/${article.id}.png`;
    await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType: "image/png" } });
    coverUrl = `/api/media/${key}`;
  }
  await c.env.DB.prepare(`UPDATE articles SET cover_url = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(coverUrl, article.id)
    .run();
  await logUsage(c.env.DB, "llm", 0.04, article.account_id, { action: "cover" });
  return c.json({ data: { cover_url: coverUrl, prompt } });
});

export const mediaRoutes = new Hono<{ Bindings: Env }>();

mediaRoutes.post("/upload", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: { code: "file_required" } }, 400);
  const key = `uploads/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await c.env.MEDIA.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });
  return c.json({ data: { object_key: key, url: `/api/media/${key}` } });
});

mediaRoutes.get("/*", async (c) => {
  const key = c.req.path.replace(/^\/api\/media\//, "");
  const obj = await c.env.MEDIA.get(key);
  if (!obj) return c.notFound();
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "public, max-age=86400");
  return new Response(obj.body, { headers });
});

export const plugRoutes = new Hono<{ Bindings: Env }>();

plugRoutes.get("/", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ data: [] });
  const rows = await c.env.DB.prepare(`SELECT * FROM plug_templates WHERE account_id = ?`)
    .bind(accountId)
    .all();
  return c.json({ data: rows.results || [] });
});

plugRoutes.post("/", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ error: { code: "no_account" } }, 400);
  const body = await c.req.json<{ name: string; body: string }>();
  const tplId = id("plug");
  await c.env.DB.prepare(
    `INSERT INTO plug_templates (id, account_id, name, body) VALUES (?, ?, ?, ?)`,
  )
    .bind(tplId, accountId, body.name, body.body)
    .run();
  return c.json({ data: { id: tplId } }, 201);
});

export const workerRoutes = new Hono<{ Bindings: Env }>();

workerRoutes.get("/", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ data: [] });
  const rows = await c.env.DB.prepare(`SELECT * FROM content_workers WHERE account_id = ?`)
    .bind(accountId)
    .all();
  return c.json({ data: rows.results || [] });
});

workerRoutes.post("/", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ error: { code: "no_account" } }, 400);
  const body = await c.req.json<{ name: string; topic_source?: string; batch_size?: number; cron?: string }>();
  const workerId = id("worker");
  await c.env.DB.prepare(
    `INSERT INTO content_workers (id, account_id, name, topic_source, batch_size, cron, next_run_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
  )
    .bind(workerId, accountId, body.name, body.topic_source || null, body.batch_size ?? 3, body.cron || "0 8 * * *")
    .run();
  return c.json({ data: { id: workerId } }, 201);
});

workerRoutes.get("/suggestions", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ data: [] });
  const status = c.req.query("status") || "to_review";
  const rows = await c.env.DB.prepare(
    `SELECT * FROM ai_suggestions WHERE account_id = ? AND status = ? ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(accountId, status)
    .all();
  return c.json({ data: rows.results || [] });
});

workerRoutes.post("/suggestions/:id/draft", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const suggestion = await c.env.DB.prepare(`SELECT * FROM ai_suggestions WHERE id = ?`)
    .bind(c.req.param("id"))
    .first<{ id: string; account_id: string; text: string }>();
  if (!suggestion) return c.json({ error: { code: "not_found" } }, 404);
  const postId = id("post");
  await c.env.DB.prepare(
    `INSERT INTO scheduled_posts (id, account_id, status, text, parts_json) VALUES (?, ?, 'draft', ?, ?)`,
  )
    .bind(postId, suggestion.account_id, suggestion.text, JSON.stringify([{ text: suggestion.text }]))
    .run();
  await c.env.DB.prepare(
    `UPDATE ai_suggestions SET status = 'drafted', post_id = ? WHERE id = ?`,
  )
    .bind(postId, suggestion.id)
    .run();
  return c.json({ data: { post_id: postId } });
});

workerRoutes.post("/suggestions/:id/dismiss", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  await c.env.DB.prepare(`UPDATE ai_suggestions SET status = 'dismissed' WHERE id = ?`)
    .bind(c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

workerRoutes.post("/:id/run", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  await c.env.JOBS.send({ type: "run_content_worker", workerId: c.req.param("id") });
  return c.json({ ok: true, queued: true });
});

export const blueskyRoutes = new Hono<{ Bindings: Env }>();

blueskyRoutes.put("/connect", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ error: { code: "no_account" } }, 400);
  const body = await c.req.json<{ handle: string; app_password: string }>();
  const enc = await encryptText(c.env.TOKEN_ENCRYPTION_SECRET, body.app_password);
  await c.env.DB.prepare(
    `INSERT INTO bluesky_accounts (account_id, handle, app_password_enc) VALUES (?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET handle = excluded.handle, app_password_enc = excluded.app_password_enc`,
  )
    .bind(accountId, body.handle, enc)
    .run();
  return c.json({ ok: true });
});

export const usageRoutes = new Hono<{ Bindings: Env }>();

usageRoutes.get("/", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const rows = await c.env.DB.prepare(
    `SELECT kind, COUNT(*) as events, ROUND(SUM(cost_usd), 4) as cost_usd
     FROM usage_events
     WHERE created_at >= datetime('now', '-30 day')
     GROUP BY kind`,
  ).all();
  const total = await c.env.DB.prepare(
    `SELECT ROUND(SUM(cost_usd), 4) as cost_usd FROM usage_events WHERE created_at >= datetime('now', '-30 day')`,
  ).first();
  return c.json({ data: { by_kind: rows.results || [], total_30d_usd: total?.cost_usd ?? 0 } });
});

export const queueSettingsRoutes = new Hono<{ Bindings: Env }>();

queueSettingsRoutes.get("/", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ data: null });
  const row = await c.env.DB.prepare(`SELECT * FROM queue_settings WHERE account_id = ?`)
    .bind(accountId)
    .first();
  return c.json({ data: row });
});

queueSettingsRoutes.put("/", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await accountIdOrMain(c, user);
  if (!accountId) return c.json({ error: { code: "no_account" } }, 400);
  const body = await c.req.json<{ timezone?: string; slots?: Array<{ time: string; days: number[] }> }>();
  await c.env.DB.prepare(
    `INSERT INTO queue_settings (account_id, timezone, slots_json, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(account_id) DO UPDATE SET
       timezone = COALESCE(excluded.timezone, queue_settings.timezone),
       slots_json = COALESCE(excluded.slots_json, queue_settings.slots_json),
       updated_at = datetime('now')`,
  )
    .bind(accountId, body.timezone || "UTC", JSON.stringify(body.slots || []))
    .run();
  return c.json({ ok: true });
});
