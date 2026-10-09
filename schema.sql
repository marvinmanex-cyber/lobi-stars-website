-- Lobi Stars ticketing system schema (Cloudflare D1 / SQLite)
-- Apply with: wrangler d1 execute lobi-stars-tickets --file=./schema.sql

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  competition TEXT NOT NULL DEFAULT 'NPFL',
  event_date TEXT NOT NULL,      -- ISO 8601, e.g. 2026-08-15T15:00:00Z
  venue TEXT NOT NULL,
  vip_price_kobo INTEGER NOT NULL,
  premium_price_kobo INTEGER NOT NULL,
  regular_price_kobo INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,  -- 0 to hide from /api/events without deleting
  programme_url TEXT,            -- e.g. /images/matchday-programme.jpeg, set from Manage Matches
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,           -- e.g. LS-ORD-XXXXXXXX
  event_id TEXT NOT NULL REFERENCES events(id),
  buyer_name TEXT NOT NULL,
  buyer_email TEXT NOT NULL,
  buyer_phone TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('VIP', 'Premium', 'Regular')),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  unit_price_kobo INTEGER NOT NULL,
  total_kobo INTEGER NOT NULL,
  paystack_reference TEXT UNIQUE NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,           -- e.g. LS-TIX-XXXXXXXXXXXX, encoded in the QR code
  order_id TEXT NOT NULL REFERENCES orders(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  tier TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'used', 'void')),
  used_at TEXT,
  scanned_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS food_orders (
  id TEXT PRIMARY KEY,           -- e.g. LS-FOOD-XXXXXXXX
  seat TEXT NOT NULL,
  stand TEXT,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  items_json TEXT NOT NULL,      -- JSON array of {id, name, priceKobo, qty}
  total_kobo INTEGER NOT NULL,
  paystack_reference TEXT UNIQUE NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,           -- e.g. LS-MBR-XXXXXX
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  state TEXT,
  tier TEXT NOT NULL DEFAULT 'Official',
  password_hash TEXT NOT NULL,   -- PBKDF2-SHA256, format: iterations:saltHex:hashHex
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- First-party visitor analytics. No IP address or personal data is stored:
-- visitor_id / session_id are random ids generated in the browser, and the
-- geo/device columns come from what Cloudflare already attaches to the edge
-- request. Feeds /api/track (write) and /admin/analytics (read).
CREATE TABLE IF NOT EXISTS pageviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  visitor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  referrer_host TEXT,
  country TEXT,
  city TEXT,
  device TEXT,                        -- 'mobile' | 'tablet' | 'desktop'
  is_new_visitor INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_members_email ON members(email);
CREATE INDEX IF NOT EXISTS idx_orders_event ON orders(event_id);
CREATE INDEX IF NOT EXISTS idx_tickets_order ON tickets(order_id);
CREATE INDEX IF NOT EXISTS idx_tickets_event ON tickets(event_id);
CREATE INDEX IF NOT EXISTS idx_pageviews_ts ON pageviews(ts);
CREATE INDEX IF NOT EXISTS idx_pageviews_path ON pageviews(path);
CREATE INDEX IF NOT EXISTS idx_pageviews_visitor ON pageviews(visitor_id);

-- Seed a couple of example events so /api/events isn't empty on first deploy.
-- Edit dates/teams/prices to match real fixtures, or delete these rows.
-- All tiers priced at 100 naira (10000 kobo) for now -- easy to raise once
-- real pricing is decided; see DEPLOYMENT.md for the live-database update.
INSERT OR IGNORE INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo, active) VALUES
  ('evt-sample-1', 'Lobi Stars FC', 'Kada Warriors FC', 'NNL Conference D', '2026-08-29T15:30:00Z', 'McCarthy Stadium, Makurdi', 10000, 10000, 10000, 1),
  ('evt-sample-2', 'Lobi Stars FC', 'Wikki Tourists FC', 'NNL Conference D', '2026-09-06T15:30:00Z', 'McCarthy Stadium, Makurdi', 10000, 10000, 10000, 1);

-- Newsletter sign-ups from the site footer (separate from membership).
-- /api/newsletter also creates this table on first use.
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  email TEXT PRIMARY KEY,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Match Centre details for a match (preview, line-ups, live timeline,
-- report, stats, gallery, score). Edited at /admin/match-centre; the API
-- also creates this table on first use.
CREATE TABLE IF NOT EXISTS match_centre (
  event_id TEXT PRIMARY KEY REFERENCES events(id),
  status TEXT NOT NULL DEFAULT 'scheduled',
  home_score INTEGER,
  away_score INTEGER,
  preview TEXT,
  report TEXT,
  lineups_json TEXT,
  timeline_json TEXT,
  stats_json TEXT,
  gallery_json TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Fan accounts reuse the members table. These columns/tables are added
-- automatically by functions/api/_lib/fans.js (ensureFanSchema):
--   ALTER TABLE members ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1;  -- existing members count as verified
--   ALTER TABLE members ADD COLUMN email_verified_at TEXT;
--   ALTER TABLE members ADD COLUMN phone_e164 TEXT;                             -- +234 format, unique
--   ALTER TABLE members ADD COLUMN marketing_opt_in INTEGER NOT NULL DEFAULT 0;
--   ALTER TABLE members ADD COLUMN age_confirmed_at TEXT;
--   ALTER TABLE members ADD COLUMN is_staff INTEGER NOT NULL DEFAULT 0;        -- club staff/players can't win prizes
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_phone_e164 ON members(phone_e164) WHERE phone_e164 IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,     -- SHA-256 of the one-time link token
  member_id TEXT NOT NULL REFERENCES members(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
  expires_at INTEGER NOT NULL,     -- ms since epoch
  used_at INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- Staff accounts + audit log (functions/api/_lib/adminSession.js).
-- The owner signs in with ADMIN_CODE; everyone else has a row here.
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  can_export_fan_data INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS admin_log (       -- every export, deletion and unsubscribe
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  staff_id TEXT NOT NULL,
  staff_name TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT
);

-- Analytics (functions/api/_lib/analytics.js). pageviews gains:
--   visitor_hash (salted daily hash, no IPs), consent, region, browser,
--   utm_source, utm_medium, utm_campaign
CREATE TABLE IF NOT EXISTS track_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  name TEXT NOT NULL,              -- partner_click, watch_play, brochure_download, ...
  label TEXT,                      -- partner slug, match slug, ...
  path TEXT,
  visitor_key TEXT,
  device TEXT,
  country TEXT,
  region TEXT
);

-- Fan database (functions/api/_lib/contacts.js): one row per person,
-- merged by email or +234 phone, linked to every original record.
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  first_name TEXT,
  surname TEXT,
  state TEXT,
  first_source TEXT,
  first_seen TEXT,
  last_seen TEXT,
  marketing_consent INTEGER NOT NULL DEFAULT 0,
  unsubscribed_at TEXT,
  unsub_token TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS contact_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  source TEXT NOT NULL,
  ref_table TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  label TEXT,
  UNIQUE (source, ref_table, ref_id)
);
CREATE TABLE IF NOT EXISTS enquiries (       -- also still sent to Formspree
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('contact', 'partnership')),
  first_name TEXT, surname TEXT, company TEXT,
  email TEXT NOT NULL, phone TEXT, subject TEXT, interest TEXT, category TEXT, message TEXT,
  privacy_consent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE IF NOT EXISTS download_leads (
  id TEXT PRIMARY KEY,
  file TEXT NOT NULL,
  first_name TEXT, surname TEXT, company TEXT,
  email TEXT NOT NULL, phone TEXT,
  marketing_consent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
