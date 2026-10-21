-- Score verification, Phases 2-4: staff decisions, score messages, the
-- consensus state per match, settings and sent alerts. (The website also
-- creates these on first use.) league_fixtures.verification: CONFIRMED,
-- VERIFIED or OFFICIAL count in the table; UNCONFIRMED / CONFLICT don't;
-- empty = a result from before score verification (counts as before).
CREATE TABLE IF NOT EXISTS score_decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, fixture_id INTEGER NOT NULL, kind TEXT NOT NULL,
  home_goals INTEGER, away_goals INTEGER, status TEXT NOT NULL, reason TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS idx_score_decisions_fixture ON score_decisions (fixture_id, active);
CREATE TABLE IF NOT EXISTS score_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT NOT NULL, sender TEXT, sender_name TEXT,
  subject TEXT, body TEXT NOT NULL, received_at TEXT NOT NULL, source_type TEXT, source_identity TEXT, method TEXT, status TEXT NOT NULL DEFAULT 'new',
  result_json TEXT, error TEXT, entered_by TEXT);
CREATE INDEX IF NOT EXISTS idx_score_messages_received ON score_messages (received_at);
CREATE TABLE IF NOT EXISTS score_state (fixture_id INTEGER PRIMARY KEY, state TEXT NOT NULL, home_goals INTEGER, away_goals INTEGER, status TEXT, minute TEXT,
  explanation TEXT, sources_json TEXT, conflict_since TEXT, conflict_key TEXT, applied_key TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS score_settings (key TEXT PRIMARY KEY, value TEXT, updated_by TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS score_alerts (key TEXT PRIMARY KEY, subject TEXT, sent_to INTEGER, created_at TEXT NOT NULL);
-- league_fixtures.verification is added by the website itself on first use
-- (ensureConsensusSchema), so this file never fails when it already exists.
