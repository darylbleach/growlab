#!/usr/bin/env node
/**
 * GrowLab CLI — thin HTTP client against your deployed Worker.
 * Usage:
 *   GROWLAB_URL=https://growlab.<subdomain>.workers.dev GROWLAB_KEY=glk_... node apps/cli/growlab.mjs posts
 */
const base = process.env.GROWLAB_URL?.replace(/\/$/, "");
const key = process.env.GROWLAB_KEY;
if (!base || !key) {
  console.error("Set GROWLAB_URL and GROWLAB_KEY");
  process.exit(1);
}

async function api(path, init) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const json = await res.json();
  if (!res.ok) {
    console.error(JSON.stringify(json, null, 2));
    process.exit(1);
  }
  return json;
}

const [cmd, ...rest] = process.argv.slice(2);
const commands = {
  async me() {
    console.log(JSON.stringify(await api("/api/me"), null, 2));
  },
  async posts() {
    console.log(JSON.stringify(await api("/api/posts"), null, 2));
  },
  async analytics() {
    console.log(JSON.stringify(await api("/api/analytics"), null, 2));
  },
  async schedule() {
    const text = rest.join(" ") || "Hello from GrowLab CLI";
    const at = new Date(Date.now() + 5 * 60_000).toISOString();
    console.log(
      JSON.stringify(
        await api("/api/posts", {
          method: "POST",
          body: JSON.stringify({ text, scheduled_for: at }),
        }),
        null,
        2,
      ),
    );
  },
  async leads() {
    console.log(JSON.stringify(await api("/api/signals/leads"), null, 2));
  },
  async usage() {
    console.log(JSON.stringify(await api("/api/usage"), null, 2));
  },
};

if (!cmd || !commands[cmd]) {
  console.log(`GrowLab CLI
Commands: ${Object.keys(commands).join(", ")}
Env: GROWLAB_URL, GROWLAB_KEY`);
  process.exit(cmd ? 1 : 0);
}
await commands[cmd]();
