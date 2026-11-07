-- MatchDay Kitchen order workflow, Phase 3 (7 November 2026): customer ratings, retry records and
-- each runner's delivery zone. Nothing is dropped or renamed. The website also creates all of this
-- by itself on first use (ensureFoodSchema, ensureKitchenSchema). Zones live in each venue's settings_json.
CREATE TABLE IF NOT EXISTS food_ratings (order_id TEXT PRIMARY KEY, food INTEGER NOT NULL, speed INTEGER NOT NULL, service INTEGER NOT NULL, comment TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_food_ratings_at ON food_ratings (created_at);
CREATE TABLE IF NOT EXISTS mk_idempotency (key TEXT PRIMARY KEY, status INTEGER, body TEXT, at TEXT NOT NULL);
ALTER TABLE mk_staff ADD COLUMN zone_id TEXT;
