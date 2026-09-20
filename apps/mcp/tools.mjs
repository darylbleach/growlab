/**
 * Minimal MCP-style tool server sketch for GrowLab.
 * Run against your Worker with GROWLAB_URL + GROWLAB_KEY.
 * For Cursor: point an MCP config at a wrapper that calls these tools,
 * or use the CLI from an agent skill.
 */
export const tools = [
  {
    name: "growlab_me",
    description: "List connected X accounts and config flags",
    path: "/api/me",
  },
  {
    name: "growlab_analytics",
    description: "Get post analytics totals and top/worst posts",
    path: "/api/analytics",
  },
  {
    name: "growlab_list_posts",
    description: "List scheduled/draft/sent posts",
    path: "/api/posts",
  },
  {
    name: "growlab_list_leads",
    description: "List Signal Agent leads",
    path: "/api/signals/leads",
  },
  {
    name: "growlab_usage",
    description: "30-day estimated X/LLM spend",
    path: "/api/usage",
  },
];

export async function callTool(name, { url, key }) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool ${name}`);
  const res = await fetch(`${url.replace(/\/$/, "")}${tool.path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  return res.json();
}
