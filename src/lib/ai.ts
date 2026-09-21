import type { Env } from "../env";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export function aiConfigured(env: Env): boolean {
  return Boolean(env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY);
}

export async function chat(
  env: Env,
  messages: ChatMessage[],
  opts?: { model?: string; temperature?: number; maxTokens?: number },
): Promise<string> {
  if (env.ANTHROPIC_API_KEY) {
    return anthropicChat(env.ANTHROPIC_API_KEY, messages, opts);
  }
  if (env.OPENAI_API_KEY) {
    return openaiChat(env.OPENAI_API_KEY, messages, opts);
  }
  throw new Error("No LLM API key configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.");
}

async function openaiChat(
  key: string,
  messages: ChatMessage[],
  opts?: { model?: string; temperature?: number; maxTokens?: number },
) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts?.model || "gpt-4o-mini",
      temperature: opts?.temperature ?? 0.7,
      max_tokens: opts?.maxTokens ?? 1200,
      messages,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error: ${await res.text()}`);
  const json = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return json.choices[0]?.message?.content?.trim() || "";
}

async function anthropicChat(
  key: string,
  messages: ChatMessage[],
  opts?: { model?: string; temperature?: number; maxTokens?: number },
) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2024-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts?.model || "claude-sonnet-4-20250514",
      max_tokens: opts?.maxTokens ?? 1200,
      temperature: opts?.temperature ?? 0.7,
      system: system || undefined,
      messages: rest.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error: ${await res.text()}`);
  const json = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  return json.content.find((c) => c.type === "text")?.text?.trim() || "";
}

export async function logUsage(
  db: D1Database,
  kind: string,
  costUsd: number,
  accountId?: string,
  meta?: unknown,
) {
  await db
    .prepare(
      `INSERT INTO usage_events (id, account_id, kind, units, cost_usd, meta_json) VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .bind(crypto.randomUUID(), accountId || null, kind, costUsd, meta ? JSON.stringify(meta) : null)
    .run();
}
