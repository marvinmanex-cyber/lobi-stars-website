-- League, fixtures and table (all tables start with league_).
-- Made by scripts/build-league-seed-sql.mjs: edit functions/api/_lib/leagueDb.js or
-- functions/api/_lib/league/seed.js and run it again, never this file.

CREATE TABLE IF NOT EXISTS league_competitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  season TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'league',
  has_table INTEGER NOT NULL DEFAULT 1,
  points_win INTEGER NOT NULL DEFAULT 3,
  points_draw INTEGER NOT NULL DEFAULT 1,
  points_loss INTEGER NOT NULL DEFAULT 0,
  tiebreak_order TEXT NOT NULL DEFAULT '["points","goal_difference","goals_for","wins","h2h_points","h2h_goal_difference","h2h_goals_for"]',
  zones TEXT NOT NULL DEFAULT '[]',
  awarded_home_goals INTEGER NOT NULL DEFAULT 3,
  awarded_away_goals INTEGER NOT NULL DEFAULT 0,
  include_live INTEGER NOT NULL DEFAULT 0,
  start_date TEXT, end_date TEXT,
  break_start TEXT, break_end TEXT, break_label TEXT,
  is_current INTEGER NOT NULL DEFAULT 0,
  rules_updated_at TEXT,
  created_at TEXT DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS league_venues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  city TEXT);

CREATE TABLE IF NOT EXISTS league_teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  crest_url TEXT,
  colour TEXT,
  home_venue_id INTEGER REFERENCES league_venues(id),
  is_lobi INTEGER NOT NULL DEFAULT 0,
  aliases TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS league_competition_teams (
  competition_id INTEGER NOT NULL REFERENCES league_competitions(id),
  team_id INTEGER NOT NULL REFERENCES league_teams(id),
  PRIMARY KEY (competition_id, team_id));

CREATE TABLE IF NOT EXISTS league_fixtures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL REFERENCES league_competitions(id),
  match_no INTEGER NOT NULL,
  matchday INTEGER,
  round INTEGER,
  home_team_id INTEGER NOT NULL REFERENCES league_teams(id),
  away_team_id INTEGER NOT NULL REFERENCES league_teams(id),
  venue_id INTEGER REFERENCES league_venues(id),
  kickoff_at TEXT,
  original_kickoff_at TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  home_goals INTEGER,
  away_goals INTEGER,
  result_type TEXT NOT NULL DEFAULT 'normal',
  attendance INTEGER,
  referee TEXT,
  report_url TEXT,
  note TEXT,
  postponed_reason TEXT,
  is_published INTEGER NOT NULL DEFAULT 1,
  event_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT,
  UNIQUE (competition_id, match_no),
  CHECK (home_team_id <> away_team_id));

CREATE INDEX IF NOT EXISTS idx_league_fixtures_md ON league_fixtures (competition_id, matchday);

CREATE INDEX IF NOT EXISTS idx_league_fixtures_kickoff ON league_fixtures (kickoff_at);

CREATE INDEX IF NOT EXISTS idx_league_fixtures_status ON league_fixtures (status);

CREATE INDEX IF NOT EXISTS idx_league_fixtures_home ON league_fixtures (home_team_id);

CREATE INDEX IF NOT EXISTS idx_league_fixtures_away ON league_fixtures (away_team_id);

CREATE INDEX IF NOT EXISTS idx_league_fixtures_event ON league_fixtures (event_id);

CREATE TABLE IF NOT EXISTS league_table_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL,
  team_id INTEGER NOT NULL,
  points_delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT, created_at TEXT DEFAULT (datetime('now')),
  voided_by TEXT, voided_at TEXT, void_reason TEXT);

CREATE TABLE IF NOT EXISTS league_tie_overrides (
  competition_id INTEGER NOT NULL,
  team_id INTEGER NOT NULL,
  rank_hint INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT, created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (competition_id, team_id));

CREATE TABLE IF NOT EXISTS league_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_email TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT, after_json TEXT,
  created_at TEXT DEFAULT (datetime('now')));

CREATE INDEX IF NOT EXISTS idx_league_audit_created ON league_audit_log (created_at);

CREATE INDEX IF NOT EXISTS idx_league_audit_entity ON league_audit_log (entity, entity_id);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')), updated_by TEXT);
