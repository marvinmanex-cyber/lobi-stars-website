-- Sharing pages (Share button + Admin › Share any page).
-- Optional: the site also creates these tables itself on first use
-- (functions/api/_lib/pageShare.js), so nothing breaks if this is never run.
--   npx wrangler d1 migrations apply lobi-stars-tickets --local
--   npx wrangler d1 migrations apply lobi-stars-tickets --remote

CREATE TABLE IF NOT EXISTS page_share_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  platform TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_page_share_events_path ON page_share_events (path, created_at);
CREATE INDEX IF NOT EXISTS idx_page_share_events_platform ON page_share_events (platform, created_at);

CREATE TABLE IF NOT EXISTS page_share_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT,
  platform_key TEXT NOT NULL,
  mode TEXT NOT NULL,      -- 'auto' | 'manual'
  status TEXT NOT NULL,    -- 'posted' | 'failed' | 'marked'
  external_id TEXT, external_url TEXT, error TEXT, staff_email TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_page_share_posts_url ON page_share_posts (path, platform_key, created_at);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')), updated_by TEXT);
INSERT OR IGNORE INTO settings (key, value) VALUES ('page_share_hashtags', '#LobiStarsFC #LobiStars');
