import type { Env } from "../env";
import { estimateXWriteCost, createTweet, getValidAccessToken, uploadMedia, type AccountTokens } from "../lib/x";
import { logUsage } from "../lib/ai";
import { partsForPublish } from "../lib/post-parts";

export async function getAccount(db: D1Database, accountId: string) {
  return db
    .prepare(`SELECT * FROM x_accounts WHERE id = ?`)
    .bind(accountId)
    .first<AccountTokens & { handle: string; display_name: string | null }>();
}

export async function getMainAccount(db: D1Database, userId: string) {
  return db
    .prepare(
      `SELECT * FROM x_accounts WHERE user_id = ? ORDER BY is_main DESC, created_at ASC LIMIT 1`,
    )
    .bind(userId)
    .first<AccountTokens & { handle: string }>();
}

export async function publishScheduledPost(env: Env, postId: string) {
  const post = await env.DB.prepare(`SELECT * FROM scheduled_posts WHERE id = ?`)
    .bind(postId)
    .first<{
      id: string;
      account_id: string;
      status: string;
      text: string;
      parts_json: string | null;
      auto_retweet_hours: number | null;
      auto_retweet_remove_hours: number | null;
      auto_delete_hours: number | null;
      auto_delete_threshold: number | null;
      auto_plug_template_id: string | null;
      auto_plug_threshold: number | null;
      auto_dm: number;
      cross_post_bluesky: number;
    }>();

  if (!post) throw new Error("post_not_found");
  if (post.status === "sent") return { skipped: true };

  await env.DB.prepare(
    `UPDATE scheduled_posts SET status = 'sending', updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(postId)
    .run();

  const account = await getAccount(env.DB, post.account_id);
  if (!account) throw new Error("account_not_found");

  try {
    const token = await getValidAccessToken(env, account);
    const parts = partsForPublish(post.text, post.parts_json);

    let previousId: string | undefined;
    const ids: string[] = [];
    for (const part of parts) {
      const mediaIds = await mediaIdsForPart(env, token, part.media_keys);
      const created = await createTweet(env, token, part.text, previousId, mediaIds);
      ids.push(created.id);
      previousId = created.id;
      await logUsage(env.DB, /https?:\/\//i.test(part.text) ? "x_write_url" : "x_write", estimateXWriteCost(part.text), post.account_id);
    }

    const rootId = ids[0];
    await env.DB.prepare(
      `UPDATE scheduled_posts SET status = 'sent', published_at = datetime('now'), x_post_id = ?, error = NULL, updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(rootId, postId)
      .run();

    // Schedule automations
    const autos: Array<[string, string, number, string]> = [];
    if (post.auto_retweet_hours) {
      const runAt = new Date(Date.now() + post.auto_retweet_hours * 3600_000).toISOString();
      autos.push([
        crypto.randomUUID(),
        post.account_id,
        Date.now(),
        JSON.stringify({
          id: crypto.randomUUID(),
          account_id: post.account_id,
          post_id: postId,
          kind: "auto_retweet",
          run_at: runAt,
          payload: { x_post_id: rootId, remove_hours: post.auto_retweet_remove_hours },
        }),
      ]);
      await env.DB.prepare(
        `INSERT INTO automation_events (id, account_id, post_id, kind, status, run_at, payload_json)
         VALUES (?, ?, ?, 'auto_retweet', 'pending', ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          post.account_id,
          postId,
          runAt,
          JSON.stringify({ x_post_id: rootId, remove_hours: post.auto_retweet_remove_hours }),
        )
        .run();
    }
    if (post.auto_delete_hours) {
      const runAt = new Date(Date.now() + post.auto_delete_hours * 3600_000).toISOString();
      await env.DB.prepare(
        `INSERT INTO automation_events (id, account_id, post_id, kind, status, run_at, payload_json)
         VALUES (?, ?, ?, 'auto_delete', 'pending', ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          post.account_id,
          postId,
          runAt,
          JSON.stringify({
            x_post_id: rootId,
            threshold: post.auto_delete_threshold ?? 1000,
          }),
        )
        .run();
    }
    if (post.auto_plug_template_id && post.auto_plug_threshold) {
      // Check periodically via cron; store event for 1h later then re-check
      const runAt = new Date(Date.now() + 3600_000).toISOString();
      await env.DB.prepare(
        `INSERT INTO automation_events (id, account_id, post_id, kind, status, run_at, payload_json)
         VALUES (?, ?, ?, 'auto_plug', 'pending', ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          post.account_id,
          postId,
          runAt,
          JSON.stringify({
            x_post_id: rootId,
            template_id: post.auto_plug_template_id,
            threshold: post.auto_plug_threshold,
          }),
        )
        .run();
    }

    if (post.cross_post_bluesky) {
      await crossPostBluesky(env, post.account_id, post.text).catch(() => null);
    }

    void autos;
    return { id: rootId, thread: ids };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await env.DB.prepare(
      `UPDATE scheduled_posts SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(message.slice(0, 1000), postId)
      .run();
    throw err;
  }
}

async function mediaIdsForPart(
  env: Env,
  token: Awaited<ReturnType<typeof getValidAccessToken>>,
  mediaKeys?: string[],
): Promise<string[] | undefined> {
  if (!mediaKeys?.length) return undefined;
  const mediaIds: string[] = [];
  for (const key of mediaKeys) {
    const obj = await env.MEDIA.get(key);
    if (!obj) throw new Error(`media_missing:${key}`);
    const bytes = await obj.arrayBuffer();
    if (!bytes.byteLength) throw new Error(`media_unreadable:${key}`);
    const mime = obj.httpMetadata?.contentType || mimeFromKey(key);
    const filename = key.split("/").pop() || "image.jpg";
    mediaIds.push(await uploadMedia(env, token, bytes, mime, filename));
  }
  if (mediaIds.length !== mediaKeys.length) {
    throw new Error("media_upload_incomplete");
  }
  return mediaIds;
}

function mimeFromKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

async function crossPostBluesky(env: Env, accountId: string, text: string) {
  const row = await env.DB.prepare(`SELECT * FROM bluesky_accounts WHERE account_id = ?`)
    .bind(accountId)
    .first<{ handle: string; app_password_enc: string }>();
  const handle = row?.handle || env.BLUESKY_HANDLE;
  // Lazy import-free AT Proto session create via public API
  if (!handle) return;
  // Password from env fallback for single-user
  const password = env.BLUESKY_APP_PASSWORD;
  if (!password && !row) return;

  // Use decrypt if stored — for env fallback use plain
  let appPassword = password || "";
  if (row && !password) {
    const { decryptText } = await import("../lib/crypto");
    appPassword = await decryptText(env.TOKEN_ENCRYPTION_SECRET, row.app_password_enc);
  }

  const sessionRes = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: handle, password: appPassword }),
  });
  if (!sessionRes.ok) throw new Error(`bluesky session failed: ${await sessionRes.text()}`);
  const session = (await sessionRes.json()) as { accessJwt: string; did: string };
  const postRes = await fetch("https://bsky.social/xrpc/com.atproto.repo.createRecord", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.accessJwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      repo: session.did,
      collection: "app.bsky.feed.post",
      record: {
        $type: "app.bsky.feed.post",
        text: text.slice(0, 300),
        createdAt: new Date().toISOString(),
      },
    }),
  });
  if (!postRes.ok) throw new Error(`bluesky post failed: ${await postRes.text()}`);
}

export async function enqueueDuePosts(env: Env) {
  const due = await env.DB.prepare(
    `SELECT id FROM scheduled_posts
     WHERE status = 'queued' AND scheduled_for IS NOT NULL AND scheduled_for <= datetime('now')
     ORDER BY scheduled_for ASC LIMIT 20`,
  ).all<{ id: string }>();

  for (const row of due.results || []) {
    await env.JOBS.send({ type: "publish_post", postId: row.id });
  }
  return due.results?.length || 0;
}

export async function enqueueDueAutomations(env: Env) {
  await env.JOBS.send({ type: "run_automations" });
}

export async function runDueAutomations(env: Env) {
  const due = await env.DB.prepare(
    `SELECT * FROM automation_events WHERE status = 'pending' AND run_at <= datetime('now') LIMIT 20`,
  ).all<{
    id: string;
    account_id: string;
    post_id: string | null;
    kind: string;
    payload_json: string | null;
  }>();

  for (const ev of due.results || []) {
    try {
      const payload = ev.payload_json ? JSON.parse(ev.payload_json) : {};
      const account = await getAccount(env.DB, ev.account_id);
      if (!account) throw new Error("account_missing");
      const token = await getValidAccessToken(env, account);

      if (ev.kind === "auto_retweet") {
        const { retweet } = await import("./x");
        await retweet(env, token, account.x_user_id, payload.x_post_id);
      } else if (ev.kind === "auto_delete") {
        // Fetch metrics; delete if below threshold impressions
        const { xFetch, deleteTweet } = await import("./x");
        const res = await xFetch(
          env,
          token,
          `/tweets/${payload.x_post_id}?tweet.fields=public_metrics`,
        );
        if (res.ok) {
          const json = (await res.json()) as {
            data?: { public_metrics?: { impression_count?: number; like_count?: number } };
          };
          const impressions =
            json.data?.public_metrics?.impression_count ??
            json.data?.public_metrics?.like_count ??
            0;
          if (impressions < (payload.threshold ?? 1000)) {
            await deleteTweet(env, token, payload.x_post_id);
          }
        }
      } else if (ev.kind === "auto_plug") {
        const { xFetch, createTweet } = await import("./x");
        const res = await xFetch(
          env,
          token,
          `/tweets/${payload.x_post_id}?tweet.fields=public_metrics`,
        );
        if (res.ok) {
          const json = (await res.json()) as {
            data?: { public_metrics?: { like_count?: number } };
          };
          const likes = json.data?.public_metrics?.like_count ?? 0;
          if (likes >= (payload.threshold ?? 0)) {
            const tpl = await env.DB.prepare(`SELECT body FROM plug_templates WHERE id = ?`)
              .bind(payload.template_id)
              .first<{ body: string }>();
            if (tpl) {
              await createTweet(env, token, tpl.body, payload.x_post_id);
            }
          } else {
            // re-queue in 1h if still young
            await env.DB.prepare(
              `UPDATE automation_events SET run_at = datetime('now', '+1 hour') WHERE id = ?`,
            )
              .bind(ev.id)
              .run();
            continue;
          }
        }
      } else if (ev.kind === "auto_dm") {
        const { sendDm } = await import("./x");
        await sendDm(env, token, payload.recipient_id, payload.body);
      }

      await env.DB.prepare(
        `UPDATE automation_events SET status = 'done', result_json = ? WHERE id = ?`,
      )
        .bind(JSON.stringify({ ok: true }), ev.id)
        .run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await env.DB.prepare(
        `UPDATE automation_events SET status = 'failed', result_json = ? WHERE id = ?`,
      )
        .bind(JSON.stringify({ error: message }), ev.id)
        .run();
    }
  }
}
