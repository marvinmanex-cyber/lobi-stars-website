-- Multi-source score verification, Phase 1 (21 October 2026): sources, score
-- reports (only ever added, never changed), unmatched team names and club
-- network submitters. The website also creates these by itself on first use
-- (functions/api/_lib/scores/model.js); this file is for
-- `npx wrangler d1 migrations apply lobi-stars-tickets --remote`.
-- The competition, teams (with their aliases), venues and fixtures are the
-- existing league_* tables. No existing table is changed.

-- Where results come from: on/off, priority, description; automatic sources
-- need "licence / permission confirmed" with a note before they can run.
CREATE TABLE IF NOT EXISTS score_sources (
  type TEXT PRIMARY KEY,               -- STAFF_MANUAL | CLUB_NETWORK | COMMENTARY_ASSIST | LIVE_MATCH_CONTROL | LICENSED_API | OFFICIAL_NNL | FUTURE_LICENSED
  label TEXT NOT NULL, description TEXT,
  enabled INTEGER NOT NULL DEFAULT 0, priority INTEGER NOT NULL DEFAULT 0,
  licence_confirmed INTEGER NOT NULL DEFAULT 0, licence_note TEXT,
  config_json TEXT,                    -- non-secret settings only; keys stay in Cloudflare
  last_received_at TEXT, last_error TEXT, last_error_at TEXT,
  updated_at TEXT, updated_by TEXT
);

-- Every report from every source. Never updated or deleted by the website.
CREATE TABLE IF NOT EXISTS score_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fixture_id INTEGER,                  -- league_fixtures.id (NULL while the teams/fixture are not recognised)
  source_type TEXT NOT NULL,
  source_identity TEXT NOT NULL,       -- staff id, submitter id, API name…
  source_label TEXT,
  home_goals INTEGER, away_goals INTEGER,
  status TEXT NOT NULL,                -- SCHEDULED | LIVE | HALF_TIME | FULL_TIME | POSTPONED | ABANDONED | AWARDED | CANCELLED
  minute TEXT,
  received_at TEXT NOT NULL,
  raw_json TEXT,                       -- the original message / payload
  confidence REAL, confidence_notes TEXT,
  needs_review INTEGER NOT NULL DEFAULT 0, review_reason TEXT,
  home_name TEXT, away_name TEXT,      -- the names as they arrived
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_score_reports_fixture ON score_reports (fixture_id, received_at);
CREATE INDEX IF NOT EXISTS idx_score_reports_review ON score_reports (needs_review);

-- Team names that matched no team; staff link each once (saved as an alias in league_teams.aliases).
CREATE TABLE IF NOT EXISTS score_unmatched_names (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, normalized TEXT NOT NULL UNIQUE,
  source_type TEXT, source_identity TEXT, sample TEXT,
  times_seen INTEGER NOT NULL DEFAULT 1, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | linked | dismissed
  team_id INTEGER, resolved_by TEXT, resolved_at TEXT
);

-- Approved club network submitters (other clubs' media officers): own secret link / PIN, revocable.
CREATE TABLE IF NOT EXISTS score_submitters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, club TEXT, team_id INTEGER, phone TEXT, email TEXT,
  token_hash TEXT UNIQUE, pin_hash TEXT,  -- only hashes are stored
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT, created_at TEXT NOT NULL, revoked_by TEXT, revoked_at TEXT, note TEXT
);
