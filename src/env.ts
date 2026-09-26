export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  KV: KVNamespace;
  JOBS: Queue;
  APP_NAME: string;
  APP_URL: string;
  SITE_PREFIX: string;
  APP_PASSWORD: string;
  SESSION_SECRET: string;
  TOKEN_ENCRYPTION_SECRET: string;
  DEPLOY_SECRET?: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  /** OAuth 1.0a consumer key (API Key) — used for v1.1 media/upload */
  X_API_KEY?: string;
  /** OAuth 1.0a consumer secret (API Secret) */
  X_API_SECRET?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  BLUESKY_HANDLE?: string;
  BLUESKY_APP_PASSWORD?: string;
}

export type JobMessage =
  | { type: "publish_post"; postId: string }
  | { type: "run_automations" }
  | { type: "sync_analytics"; accountId: string }
  | { type: "run_signal_agent"; agentId: string }
  | { type: "send_dm"; dmId: string }
  | { type: "run_content_worker"; workerId: string }
  | { type: "ingest_inspiration"; accountId: string; query: string };
