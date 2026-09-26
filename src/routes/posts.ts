import { Hono } from "hono";
import type { Env } from "../env";
import { requireAuth } from "../lib/auth";
import { id } from "../lib/crypto";
import { MediaKeyError, normalizePostParts, type PostPartInput } from "../lib/post-parts";
import { getMainAccount } from "../services/posts";

async function resolveAccountId(c: any, userId: string) {
  const q = c.req.query("account_id");
  if (q) return q;
  const main = await getMainAccount(c.env.DB, userId);
  return main?.id || null;
}

export const postsRoutes = new Hono<{ Bindings: Env }>();

postsRoutes.get("/", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await resolveAccountId(c, user);
  if (!accountId) return c.json({ data: [] });
  const status = c.req.query("status");
  let sql = `SELECT * FROM scheduled_posts WHERE account_id = ?`;
  const binds: string[] = [accountId];
  if (status) {
    sql += ` AND status = ?`;
    binds.push(status);
  }
  sql += ` ORDER BY updated_at DESC LIMIT 100`;
  const rows = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all();
  return c.json({ data: rows.results || [] });
});

postsRoutes.post("/", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const accountId = await resolveAccountId(c, user);
  if (!accountId) return c.json({ error: { code: "no_account", message: "Connect an X account first" } }, 400);

  const body = await c.req.json<{
    text: string;
    parts?: PostPartInput[];
    media_keys?: string[];
    scheduled_for?: string | null;
    publish_now?: boolean;
    auto_retweet_hours?: number | null;
    auto_retweet_remove_hours?: number | null;
    auto_delete_hours?: number | null;
    auto_delete_threshold?: number | null;
    auto_plug_template_id?: string | null;
    auto_plug_threshold?: number | null;
    auto_dm?: boolean;
    cross_post_bluesky?: boolean;
    tag_ids?: string[];
  }>();

  if (!body.text?.trim() && !body.parts?.length) {
    return c.json({ error: { code: "invalid", message: "text required" } }, 400);
  }

  const postId = id("post");
  let parts;
  try {
    parts = normalizePostParts({
      text: body.text,
      parts: body.parts,
      media_keys: body.media_keys,
    });
  } catch (err) {
    const message = err instanceof MediaKeyError ? err.message : "invalid parts";
    return c.json({ error: { code: "invalid", message } }, 400);
  }
  const text = parts.map((p) => p.text).join("\n\n");
  if (!text.trim()) {
    return c.json({ error: { code: "invalid", message: "text required" } }, 400);
  }

  let status = "draft";
  let scheduledFor: string | null = body.scheduled_for || null;
  if (body.publish_now) {
    status = "queued";
    scheduledFor = new Date().toISOString();
  } else if (scheduledFor) {
    status = "queued";
  }

  await c.env.DB.prepare(
    `INSERT INTO scheduled_posts (
      id, account_id, status, text, parts_json, scheduled_for, tag_ids_json,
      auto_retweet_hours, auto_retweet_remove_hours, auto_delete_hours, auto_delete_threshold,
      auto_plug_template_id, auto_plug_threshold, auto_dm, cross_post_bluesky
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      postId,
      accountId,
      status,
      text,
      JSON.stringify(parts),
      scheduledFor,
      JSON.stringify(body.tag_ids || []),
      body.auto_retweet_hours ?? null,
      body.auto_retweet_remove_hours ?? null,
      body.auto_delete_hours ?? null,
      body.auto_delete_threshold ?? 1000,
      body.auto_plug_template_id ?? null,
      body.auto_plug_threshold ?? null,
      body.auto_dm ? 1 : 0,
      body.cross_post_bluesky ? 1 : 0,
    )
    .run();

  if (body.publish_now) {
    await c.env.JOBS.send({ type: "publish_post", postId });
  }

  const row = await c.env.DB.prepare(`SELECT * FROM scheduled_posts WHERE id = ?`).bind(postId).first();
  return c.json({ data: row }, 201);
});

postsRoutes.patch("/:id", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const body = await c.req.json<Record<string, unknown>>();
  const postId = c.req.param("id");
  const existing = await c.env.DB.prepare(`SELECT * FROM scheduled_posts WHERE id = ?`)
    .bind(postId)
    .first();
  if (!existing) return c.json({ error: { code: "not_found" } }, 404);

  const fields: string[] = [];
  const values: unknown[] = [];
  const map: Record<string, string> = {
    text: "text",
    scheduled_for: "scheduled_for",
    status: "status",
    auto_retweet_hours: "auto_retweet_hours",
    auto_delete_hours: "auto_delete_hours",
    auto_delete_threshold: "auto_delete_threshold",
    auto_plug_template_id: "auto_plug_template_id",
    auto_plug_threshold: "auto_plug_threshold",
    auto_dm: "auto_dm",
    cross_post_bluesky: "cross_post_bluesky",
  };
  for (const [k, col] of Object.entries(map)) {
    if (k in body) {
      fields.push(`${col} = ?`);
      let v = body[k];
      if (k === "auto_dm" || k === "cross_post_bluesky") v = v ? 1 : 0;
      values.push(v);
    }
  }
  if (body.parts || body.media_keys) {
    try {
      const parts = normalizePostParts({
        text: typeof body.text === "string" ? body.text : undefined,
        parts: body.parts as PostPartInput[] | undefined,
        media_keys: body.media_keys,
      });
      fields.push("parts_json = ?");
      values.push(JSON.stringify(parts));
      if (!("text" in body)) {
        fields.push("text = ?");
        values.push(parts.map((p) => p.text).join("\n\n"));
      }
    } catch (err) {
      const message = err instanceof MediaKeyError ? err.message : "invalid parts";
      return c.json({ error: { code: "invalid", message } }, 400);
    }
  }
  if (body.scheduled_for && !body.status) {
    fields.push("status = ?");
    values.push("queued");
  }
  if (!fields.length) return c.json({ error: { code: "empty" } }, 400);
  fields.push("updated_at = datetime('now')");
  values.push(postId);
  await c.env.DB.prepare(`UPDATE scheduled_posts SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
  const row = await c.env.DB.prepare(`SELECT * FROM scheduled_posts WHERE id = ?`).bind(postId).first();
  return c.json({ data: row });
});

postsRoutes.delete("/:id", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  await c.env.DB.prepare(`DELETE FROM scheduled_posts WHERE id = ?`).bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

postsRoutes.post("/:id/publish", async (c) => {
  const user = await requireAuth(c);
  if (typeof user !== "string") return user;
  const postId = c.req.param("id");
  await c.env.DB.prepare(
    `UPDATE scheduled_posts SET status = 'queued', scheduled_for = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(postId)
    .run();
  await c.env.JOBS.send({ type: "publish_post", postId });
  return c.json({ ok: true, queued: true });
});
