import type { Env } from "../env";
import { r2KeyFromCoverUrl } from "../lib/article-schedule";
import { markdownToDraftJs } from "../lib/markdown-to-draftjs";
import {
  createArticleDraft,
  getValidAccessToken,
  publishArticle,
  uploadMedia,
  type AccountTokens,
} from "../lib/x";
import { logUsage } from "../lib/ai";
import { getAccount } from "./posts";

export type ArticleRow = {
  id: string;
  account_id: string;
  title: string;
  content_markdown: string;
  cover_url: string | null;
  status: string;
  scheduled_for: string | null;
  published_at: string | null;
  x_article_id: string | null;
  error: string | null;
};

/**
 * Publish a GrowLab article to X Articles.
 *
 * `articles.x_article_id` is the X Article id from POST /2/articles/draft (`data.id`),
 * not the seed post_id from publish. Seed post_id is not persisted — we keep the Article
 * id so a create-then-failed-publish can retry without leaving an untracked X draft.
 */
export async function publishScheduledArticle(env: Env, articleId: string) {
  const article = await env.DB.prepare(`SELECT * FROM articles WHERE id = ?`)
    .bind(articleId)
    .first<ArticleRow>();
  if (!article) throw new Error("article_not_found");
  if (article.status === "published") {
    return { skipped: true as const, x_article_id: article.x_article_id };
  }

  await env.DB.prepare(
    `UPDATE articles SET status = 'sending', updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(articleId)
    .run();

  const account = await getAccount(env.DB, article.account_id);
  if (!account) {
    await failArticle(env, articleId, article.x_article_id, "account_not_found");
    throw new Error("account_not_found");
  }

  let xArticleId = article.x_article_id;
  try {
    const auth = await getValidAccessToken(env, account as AccountTokens);
    const converted = markdownToDraftJs(article.content_markdown || "");
    const content_state = { blocks: converted.blocks, entities: converted.entities };

    let coverMediaId: string | undefined;
    if (!xArticleId) {
      if (article.cover_url) {
        coverMediaId = await uploadCover(env, auth, article.cover_url);
      }
      const draft = await createArticleDraft(env, auth, {
        title: article.title,
        content_state,
        coverMediaId,
      });
      xArticleId = draft.id;
      await env.DB.prepare(
        `UPDATE articles SET x_article_id = ?, updated_at = datetime('now') WHERE id = ?`,
      )
        .bind(xArticleId, articleId)
        .run();
    }

    await publishArticle(env, auth, xArticleId);
    await env.DB.prepare(
      `UPDATE articles SET status = 'published', published_at = datetime('now'), error = NULL, updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(articleId)
      .run();
    await logUsage(env.DB, "x_write", 0.2, article.account_id, { action: "article_publish" });
    return { x_article_id: xArticleId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failArticle(env, articleId, xArticleId, message);
    throw err;
  }
}

async function failArticle(env: Env, articleId: string, xArticleId: string | null, message: string) {
  await env.DB.prepare(
    `UPDATE articles SET status = 'failed', error = ?, x_article_id = COALESCE(?, x_article_id), updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(message.slice(0, 1000), xArticleId, articleId)
    .run();
}

async function uploadCover(
  env: Env,
  auth: Awaited<ReturnType<typeof getValidAccessToken>>,
  coverUrl: string,
): Promise<string> {
  const { bytes, mime, filename } = await loadCoverBytes(env, coverUrl);
  if (!bytes.byteLength) throw new Error("cover_unreadable");
  return uploadMedia(env, auth, bytes, mime, filename);
}

async function loadCoverBytes(
  env: Env,
  coverUrl: string,
): Promise<{ bytes: ArrayBuffer; mime: string; filename: string }> {
  const key = r2KeyFromCoverUrl(coverUrl);
  if (key) {
    const obj = await env.MEDIA.get(key);
    if (!obj) throw new Error(`cover_missing:${key}`);
    const bytes = await obj.arrayBuffer();
    const mime = obj.httpMetadata?.contentType || mimeFromKey(key);
    return { bytes, mime, filename: key.split("/").pop() || "cover.jpg" };
  }
  if (!/^https?:\/\//i.test(coverUrl)) throw new Error(`cover_unreadable:${coverUrl}`);
  const res = await fetch(coverUrl);
  if (!res.ok) throw new Error(`cover_fetch_failed:${res.status}`);
  const bytes = await res.arrayBuffer();
  const mime = res.headers.get("content-type") || "image/jpeg";
  const filename = coverUrl.split("/").pop()?.split("?")[0] || "cover.jpg";
  return { bytes, mime, filename };
}

function mimeFromKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export async function enqueueDueArticles(env: Env) {
  const due = await env.DB.prepare(
    `SELECT id FROM articles
     WHERE status = 'scheduled' AND scheduled_for IS NOT NULL AND scheduled_for <= datetime('now')
     ORDER BY scheduled_for ASC LIMIT 10`,
  ).all<{ id: string }>();

  for (const row of due.results || []) {
    await env.JOBS.send({ type: "publish_article", articleId: row.id });
  }
  return due.results?.length || 0;
}
