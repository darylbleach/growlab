-- GrowLab initial schema
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS x_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  x_user_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  token_expires_at TEXT,
  scopes TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  is_main INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, x_user_id)
);

CREATE TABLE IF NOT EXISTS context_settings (
  account_id TEXT PRIMARY KEY,
  profile_description TEXT,
  interests_json TEXT NOT NULL DEFAULT '[]',
  rules_json TEXT NOT NULL DEFAULT '[]',
  style_guide_generated TEXT,
  style_guide_override TEXT,
  favorite_creators_json TEXT NOT NULL DEFAULT '[]',
  products_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS queue_settings (
  account_id TEXT PRIMARY KEY,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  slots_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'blue',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS scheduled_posts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- draft|queued|sending|sent|failed|cancelled
  text TEXT NOT NULL,
  parts_json TEXT, -- thread parts [{text, media_keys[]}]
  scheduled_for TEXT,
  published_at TEXT,
  x_post_id TEXT,
  error TEXT,
  tag_ids_json TEXT NOT NULL DEFAULT '[]',
  auto_retweet_hours INTEGER,
  auto_retweet_remove_hours INTEGER,
  auto_delete_hours INTEGER,
  auto_delete_threshold INTEGER DEFAULT 1000,
  auto_plug_template_id TEXT,
  auto_plug_threshold INTEGER,
  auto_dm INTEGER NOT NULL DEFAULT 0,
  cross_post_bluesky INTEGER NOT NULL DEFAULT 0,
  bluesky_uri TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scheduled_due ON scheduled_posts(status, scheduled_for);

CREATE TABLE IF NOT EXISTS plug_templates (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts_cache (
  id TEXT PRIMARY KEY, -- x post id
  account_id TEXT NOT NULL,
  text TEXT,
  created_at_x TEXT,
  likes INTEGER NOT NULL DEFAULT 0,
  replies INTEGER NOT NULL DEFAULT 0,
  reposts INTEGER NOT NULL DEFAULT 0,
  quotes INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  bookmarks INTEGER NOT NULL DEFAULT 0,
  is_reply INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_posts_account ON posts_cache(account_id, created_at_x);

CREATE TABLE IF NOT EXISTS metrics_daily (
  id TEXT PRIMARY KEY, -- account_id:date
  account_id TEXT NOT NULL,
  day TEXT NOT NULL,
  posts INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  engagements INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  replies INTEGER NOT NULL DEFAULT 0,
  reposts INTEGER NOT NULL DEFAULT 0,
  follower_count INTEGER,
  follower_delta INTEGER,
  UNIQUE(account_id, day)
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  x_user_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  display_name TEXT,
  bio TEXT,
  avatar_url TEXT,
  followers_count INTEGER,
  following_count INTEGER,
  verified INTEGER NOT NULL DEFAULT 0,
  engaged_replies INTEGER NOT NULL DEFAULT 0,
  engaged_reposts INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, x_user_id)
);
CREATE INDEX IF NOT EXISTS idx_contacts_handle ON contacts(account_id, handle);

CREATE TABLE IF NOT EXISTS contact_lists (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  kind TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contact_list_members (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(list_id, contact_id)
);

CREATE TABLE IF NOT EXISTS contact_notes (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS engage_feeds (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  keywords_json TEXT,
  x_list_id TEXT,
  contact_list_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signal_agents (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  icp_description TEXT NOT NULL,
  precision_mode TEXT NOT NULL DEFAULT 'high',
  status TEXT NOT NULL DEFAULT 'active', -- active|paused
  destination_list_id TEXT,
  rubric_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signal_watches (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL, -- keyword_watch|profile_watch|follower_watch|list_watch
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signal_leads (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  x_user_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  display_name TEXT,
  bio TEXT,
  avatar_url TEXT,
  followers_count INTEGER,
  icp_score REAL,
  icp_rationale TEXT,
  provenance_json TEXT,
  feedback TEXT, -- fit|not_fit|null
  deposited INTEGER NOT NULL DEFAULT 0,
  deposited_at TEXT,
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, x_user_id)
);

CREATE TABLE IF NOT EXISTS inspiration_posts (
  id TEXT PRIMARY KEY,
  x_post_id TEXT,
  author_handle TEXT,
  text TEXT NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0,
  replies INTEGER NOT NULL DEFAULT 0,
  reposts INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  topic TEXT,
  niche TEXT,
  source TEXT NOT NULL DEFAULT 'ingest',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_inspiration_topic ON inspiration_posts(topic);
CREATE INDEX IF NOT EXISTS idx_inspiration_fts_text ON inspiration_posts(text);

CREATE TABLE IF NOT EXISTS ai_suggestions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  worker_id TEXT,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'to_review', -- to_review|drafted|scheduled|dismissed
  post_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS content_workers (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  topic_source TEXT,
  batch_size INTEGER NOT NULL DEFAULT 3,
  cron TEXT NOT NULL DEFAULT '0 8 * * *',
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dm_campaigns (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dm_queue (
  id TEXT PRIMARY KEY,
  campaign_id TEXT,
  account_id TEXT NOT NULL,
  recipient_x_user_id TEXT NOT NULL,
  recipient_handle TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|sending|sent|failed|cancelled
  scheduled_for TEXT,
  sent_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content_markdown TEXT NOT NULL,
  cover_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_for TEXT,
  published_at TEXT,
  x_article_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS automation_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  post_id TEXT,
  kind TEXT NOT NULL, -- auto_retweet|auto_plug|auto_delete|auto_dm
  status TEXT NOT NULL DEFAULT 'pending',
  run_at TEXT NOT NULL,
  payload_json TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_auto_due ON automation_events(status, run_at);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  kind TEXT NOT NULL, -- x_read|x_write|x_write_url|llm|dm
  units REAL NOT NULL DEFAULT 1,
  cost_usd REAL NOT NULL DEFAULT 0,
  meta_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bluesky_accounts (
  account_id TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  did TEXT,
  app_password_enc TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT 'read,write',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
