import type { Env } from "../env";
import { chat, logUsage } from "../lib/ai";
import { getValidAccessToken, searchRecent } from "../lib/x";
import { getAccount } from "./posts";
import { id } from "../lib/crypto";

export async function loadVoiceContext(db: D1Database, accountId: string) {
  const ctx = await db
    .prepare(`SELECT * FROM context_settings WHERE account_id = ?`)
    .bind(accountId)
    .first<{
      profile_description: string | null;
      interests_json: string;
      rules_json: string;
      style_guide_generated: string | null;
      style_guide_override: string | null;
      favorite_creators_json: string;
      products_json: string;
    }>();

  const recent = await db
    .prepare(
      `SELECT text FROM posts_cache WHERE account_id = ? AND is_reply = 0 ORDER BY created_at_x DESC LIMIT 30`,
    )
    .bind(accountId)
    .all<{ text: string }>();

  const style =
    ctx?.style_guide_override ||
    ctx?.style_guide_generated ||
    "Write like a sharp X creator: concise, specific, hook-first, no corporate fluff.";

  return {
    profile: ctx?.profile_description || "",
    interests: safeJson(ctx?.interests_json, [] as string[]),
    rules: safeJson(ctx?.rules_json, [] as string[]),
    style,
    favorites: safeJson(ctx?.favorite_creators_json, [] as string[]),
    products: safeJson(ctx?.products_json, [] as unknown[]),
    recentPosts: (recent.results || []).map((r) => r.text).filter(Boolean),
  };
}

function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function systemPrompt(voice: Awaited<ReturnType<typeof loadVoiceContext>>) {
  return [
    "You write posts for X (Twitter). Sound like the account, not a generic AI.",
    `Style guide:\n${voice.style}`,
    voice.profile ? `Profile context:\n${voice.profile}` : "",
    voice.interests.length ? `Interests: ${voice.interests.join(", ")}` : "",
    voice.rules.length ? `Hard rules:\n- ${voice.rules.join("\n- ")}` : "",
    voice.products.length ? `Products to subtly mention when relevant:\n${JSON.stringify(voice.products)}` : "",
    voice.recentPosts.length
      ? `Recent posts for voice reference:\n${voice.recentPosts
          .slice(0, 12)
          .map((p, i) => `${i + 1}. ${p}`)
          .join("\n")}`
      : "",
    "Never use hashtag spam. Prefer short lines. Threads use numbered parts when asked.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function writeDraft(env: Env, accountId: string, brief: string) {
  const voice = await loadVoiceContext(env.DB, accountId);
  const inspiration = await env.DB.prepare(
    `SELECT text, likes FROM inspiration_posts ORDER BY likes DESC LIMIT 8`,
  ).all<{ text: string; likes: number }>();

  const content = await chat(env, [
    { role: "system", content: systemPrompt(voice) },
    {
      role: "user",
      content: [
        `Write ONE X post from this brief:\n${brief}`,
        inspiration.results?.length
          ? `High-performing formats for inspiration (remix, do not copy):\n${inspiration.results
              .map((i) => `- (${i.likes} likes) ${i.text}`)
              .join("\n")}`
          : "",
        "Return only the post text.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ]);
  await logUsage(env.DB, "llm", 0.01, accountId, { action: "write" });
  return content;
}

export async function rewriteDraft(
  env: Env,
  accountId: string,
  text: string,
  closeness = 50,
  instruction?: string,
) {
  const voice = await loadVoiceContext(env.DB, accountId);
  const content = await chat(env, [
    { role: "system", content: systemPrompt(voice) },
    {
      role: "user",
      content: `Rewrite this X post. Closeness ${closeness}/100 (0=keep only the idea, 100=near-verbatim polish).
${instruction ? `Extra instruction: ${instruction}` : ""}

Original:
${text}

Return only the rewritten post.`,
    },
  ]);
  await logUsage(env.DB, "llm", 0.008, accountId, { action: "rewrite" });
  return content;
}

export async function writeThread(env: Env, accountId: string, brief: string, parts = 5) {
  const voice = await loadVoiceContext(env.DB, accountId);
  const content = await chat(env, [
    { role: "system", content: systemPrompt(voice) },
    {
      role: "user",
      content: `Write an X thread of ${parts} posts from this brief:\n${brief}\n\nReturn as JSON array of strings only, no markdown.`,
    },
  ]);
  await logUsage(env.DB, "llm", 0.02, accountId, { action: "thread" });
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* fall through */
  }
  return content
    .split(/\n+/)
    .map((l) => l.replace(/^\d+[\).\s-]+/, "").trim())
    .filter(Boolean);
}

export async function draftReply(env: Env, accountId: string, postText: string, author?: string) {
  const voice = await loadVoiceContext(env.DB, accountId);
  const content = await chat(env, [
    { role: "system", content: systemPrompt(voice) },
    {
      role: "user",
      content: `Draft ONE thoughtful reply to this post by @${author || "someone"}. Add value, don't suck up, keep it under 220 chars when possible.

Post:
${postText}

Return only the reply text.`,
    },
  ]);
  await logUsage(env.DB, "llm", 0.008, accountId, { action: "reply" });
  return content;
}

export async function scoreDraft(env: Env, accountId: string, draft: string) {
  const stats = await env.DB.prepare(
    `SELECT
      AVG(likes) as avg_likes,
      AVG(replies) as avg_replies,
      AVG(reposts) as avg_reposts,
      AVG(impressions) as avg_impressions
     FROM posts_cache WHERE account_id = ? AND is_reply = 0`,
  )
    .bind(accountId)
    .first<{
      avg_likes: number | null;
      avg_replies: number | null;
      avg_reposts: number | null;
      avg_impressions: number | null;
    }>();

  const voice = await loadVoiceContext(env.DB, accountId);
  const analysis = await chat(env, [
    { role: "system", content: "You score X drafts. Return strict JSON only." },
    {
      role: "user",
      content: `Score this draft 0-100 for this account.
Account averages: likes=${stats?.avg_likes ?? 0}, replies=${stats?.avg_replies ?? 0}, reposts=${stats?.avg_reposts ?? 0}, impressions=${stats?.avg_impressions ?? 0}
Style: ${voice.style}

Draft:
${draft}

Return JSON: {"score":number,"helps":string[],"hurts":string[],"expected_multiples":{"likes":number,"replies":number,"reposts":number,"views":number}}`,
    },
  ]);
  await logUsage(env.DB, "llm", 0.01, accountId, { action: "score" });
  try {
    return JSON.parse(analysis);
  } catch {
    return { score: 50, helps: [], hurts: ["Could not parse model output"], raw: analysis };
  }
}

export async function rebuildStyleGuide(env: Env, accountId: string) {
  const voice = await loadVoiceContext(env.DB, accountId);
  const guide = await chat(env, [
    {
      role: "system",
      content: "Extract a practical writing style guide from the posts. Be specific.",
    },
    {
      role: "user",
      content: `Build a style guide from these posts:\n${voice.recentPosts.join("\n---\n") || "(none yet)"}`,
    },
  ]);
  await env.DB.prepare(
    `INSERT INTO context_settings (account_id, style_guide_generated, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(account_id) DO UPDATE SET style_guide_generated = excluded.style_guide_generated, updated_at = datetime('now')`,
  )
    .bind(accountId, guide)
    .run();
  await logUsage(env.DB, "llm", 0.015, accountId, { action: "style_guide" });
  return guide;
}

export async function scoreLeadIcp(
  env: Env,
  accountId: string,
  icp: string,
  person: { handle: string; bio?: string; followers?: number },
) {
  const content = await chat(
    env,
    [
      {
        role: "system",
        content: "Score ICP fit 0-100. Return JSON {score,rationale}.",
      },
      {
        role: "user",
        content: `ICP:\n${icp}\n\nPerson @${person.handle}\nBio: ${person.bio || ""}\nFollowers: ${person.followers ?? "?"}`,
      },
    ],
    { temperature: 0.2, maxTokens: 300 },
  );
  await logUsage(env.DB, "llm", 0.005, accountId, { action: "icp" });
  try {
    return JSON.parse(content) as { score: number; rationale: string };
  } catch {
    return { score: 50, rationale: content };
  }
}

export async function runSignalAgent(env: Env, agentId: string) {
  const agent = await env.DB.prepare(`SELECT * FROM signal_agents WHERE id = ? AND status = 'active'`)
    .bind(agentId)
    .first<{
      id: string;
      account_id: string;
      icp_description: string;
      destination_list_id: string | null;
    }>();
  if (!agent) return { found: 0 };

  const watches = await env.DB.prepare(`SELECT * FROM signal_watches WHERE agent_id = ?`)
    .bind(agentId)
    .all<{ kind: string; value: string }>();

  const account = await getAccount(env.DB, agent.account_id);
  if (!account) return { found: 0 };
  const token = await getValidAccessToken(env, account);

  let found = 0;
  for (const watch of watches.results || []) {
    if (watch.kind !== "keyword_watch") continue;
    const results = await searchRecent(env, token, watch.value, 20);
    const users = new Map((results.includes?.users || []).map((u) => [u.id, u]));
    for (const tweet of results.data || []) {
      const user = users.get(tweet.author_id);
      if (!user) continue;
      const scored = await scoreLeadIcp(env, agent.account_id, agent.icp_description, {
        handle: user.username,
        bio: user.description,
        followers: user.public_metrics?.followers_count,
      });
      if (scored.score < 55) continue;
      const leadId = id("lead");
      const insert = await env.DB.prepare(
        `INSERT OR IGNORE INTO signal_leads
         (id, agent_id, account_id, x_user_id, handle, display_name, bio, avatar_url, followers_count, icp_score, icp_rationale, provenance_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          leadId,
          agentId,
          agent.account_id,
          user.id,
          user.username,
          user.name,
          user.description || null,
          user.profile_image_url || null,
          user.public_metrics?.followers_count ?? null,
          scored.score,
          scored.rationale,
          JSON.stringify({
            action: "keyword_watch",
            watch: watch.value,
            tweet_id: tweet.id,
            tweet_text: tweet.text,
          }),
        )
        .run();
      if (insert.meta.changes) found += 1;
    }
  }
  return { found };
}
