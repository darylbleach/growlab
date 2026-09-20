async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    ...init,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || res.statusText || "Request failed";
    throw new Error(msg);
  }
  return json as T;
}

export const api = {
  status: () => request<{ authenticated: boolean; x_configured: boolean; ai_configured: boolean; app_name: string }>("/api/auth/status"),
  login: (password: string) => request("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => request("/api/auth/logout", { method: "POST", body: "{}" }),
  me: () => request<{ data: { accounts: Account[]; x_configured: boolean; ai_configured: boolean } }>("/api/me"),
  accounts: () => request<{ data: Account[]; x_configured: boolean }>("/api/accounts"),
  posts: (status?: string) => request<{ data: ScheduledPost[] }>(`/api/posts${status ? `?status=${status}` : ""}`),
  createPost: (body: unknown) => request<{ data: ScheduledPost }>("/api/posts", { method: "POST", body: JSON.stringify(body) }),
  publishPost: (id: string) => request(`/api/posts/${id}/publish`, { method: "POST", body: "{}" }),
  deletePost: (id: string) => request(`/api/posts/${id}`, { method: "DELETE" }),
  write: (brief: string) => request<{ data: { text: string } }>("/api/ai/write", { method: "POST", body: JSON.stringify({ brief }) }),
  rewrite: (text: string, closeness = 50) => request<{ data: { text: string } }>("/api/ai/rewrite", { method: "POST", body: JSON.stringify({ text, closeness }) }),
  thread: (brief: string, parts = 5) => request<{ data: { parts: string[] } }>("/api/ai/thread", { method: "POST", body: JSON.stringify({ brief, parts }) }),
  score: (text: string) => request<{ data: any }>("/api/ai/score", { method: "POST", body: JSON.stringify({ text }) }),
  reply: (text: string, author?: string) => request<{ data: { text: string } }>("/api/ai/reply", { method: "POST", body: JSON.stringify({ text, author }) }),
  styleGuide: () => request("/api/ai/style-guide", { method: "POST", body: "{}" }),
  context: () => request<{ data: any }>("/api/context"),
  saveContext: (body: unknown) => request("/api/context", { method: "PUT", body: JSON.stringify(body) }),
  analytics: () => request<{ data: any }>("/api/analytics"),
  syncAnalytics: () => request("/api/analytics/sync", { method: "POST", body: "{}" }),
  feeds: () => request<{ data: any[] }>("/api/engage/feeds"),
  createFeed: (body: unknown) => request("/api/engage/feeds", { method: "POST", body: JSON.stringify(body) }),
  feedPosts: (id: string) => request<{ data: any[] }>(`/api/engage/feeds/${id}/posts`),
  agents: () => request<{ data: any[]; watches: any[] }>("/api/signals/agents"),
  createAgent: (body: unknown) => request("/api/signals/agents", { method: "POST", body: JSON.stringify(body) }),
  runAgent: (id: string) => request(`/api/signals/agents/${id}/run`, { method: "POST", body: "{}" }),
  leads: () => request<{ data: any[] }>("/api/signals/leads"),
  inspiration: (q?: string) => request<{ data: any[] }>(`/api/inspiration${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  addInspiration: (body: unknown) => request("/api/inspiration", { method: "POST", body: JSON.stringify(body) }),
  ingestInspiration: (query: string) => request("/api/inspiration/ingest", { method: "POST", body: JSON.stringify({ query }) }),
  contacts: (q?: string) => request<{ data: any[] }>(`/api/audience/contacts${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  lists: () => request<{ data: any[] }>("/api/audience/lists"),
  createList: (name: string) => request("/api/audience/lists", { method: "POST", body: JSON.stringify({ name }) }),
  plugs: () => request<{ data: any[] }>("/api/plugs"),
  createPlug: (body: unknown) => request("/api/plugs", { method: "POST", body: JSON.stringify(body) }),
  workers: () => request<{ data: any[] }>("/api/workers"),
  createWorker: (body: unknown) => request("/api/workers", { method: "POST", body: JSON.stringify(body) }),
  runWorker: (id: string) => request(`/api/workers/${id}/run`, { method: "POST", body: "{}" }),
  suggestions: () => request<{ data: any[] }>("/api/workers/suggestions"),
  draftSuggestion: (id: string) => request(`/api/workers/suggestions/${id}/draft`, { method: "POST", body: "{}" }),
  dismissSuggestion: (id: string) => request(`/api/workers/suggestions/${id}/dismiss`, { method: "POST", body: "{}" }),
  dms: () => request<{ data: any[] }>("/api/dms/queue"),
  articles: () => request<{ data: any[] }>("/api/articles"),
  createArticle: (body: unknown) => request("/api/articles", { method: "POST", body: JSON.stringify(body) }),
  usage: () => request<{ data: any }>("/api/usage"),
  createApiKey: (name: string) => request<{ key: string }>("/api/auth/api-keys", { method: "POST", body: JSON.stringify({ name }) }),
  connectBluesky: (handle: string, app_password: string) =>
    request("/api/bluesky/connect", { method: "PUT", body: JSON.stringify({ handle, app_password }) }),
  queueSettings: () => request<{ data: any }>("/api/queue-settings"),
  saveQueueSettings: (body: unknown) => request("/api/queue-settings", { method: "PUT", body: JSON.stringify(body) }),
};

export type Account = {
  id: string;
  handle: string;
  display_name?: string;
  avatar_url?: string;
  is_main: number;
};

export type ScheduledPost = {
  id: string;
  status: string;
  text: string;
  scheduled_for?: string;
  published_at?: string;
  x_post_id?: string;
  error?: string;
  created_at: string;
};
