-- MatchDay Kitchen order workflow, Phase 2 (6 November 2026): the match-day shift, escalation
-- records, sold-out per venue, delivery codes and runner claims. Nothing is dropped or renamed.
-- The website also creates all of this by itself on first use (ensureFoodSchema in
-- functions/api/_lib/foodOrders.js, ensureKitchenSchema in matchdayKitchen.js).
CREATE TABLE IF NOT EXISTS mk_venue_shifts (id TEXT PRIMARY KEY, venue_id TEXT NOT NULL, started_by TEXT, started_at TEXT NOT NULL, ended_by TEXT, ended_at TEXT);
CREATE INDEX IF NOT EXISTS idx_venue_shift ON mk_venue_shifts (venue_id, ended_at);
CREATE TABLE IF NOT EXISTS order_escalations (order_id TEXT NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (order_id, kind));
CREATE TABLE IF NOT EXISTS food_item_venue (item_id TEXT NOT NULL, venue_id TEXT NOT NULL, sold_out INTEGER NOT NULL DEFAULT 0, updated_at TEXT, PRIMARY KEY (item_id, venue_id));
ALTER TABLE food_orders ADD COLUMN delivery_code TEXT;
ALTER TABLE food_orders ADD COLUMN claimed_by TEXT;
ALTER TABLE food_orders ADD COLUMN claimed_name TEXT;
ALTER TABLE food_orders ADD COLUMN claimed_at TEXT;
ALTER TABLE food_orders ADD COLUMN accepted_iso TEXT;
ALTER TABLE mk_staff ADD COLUMN phone TEXT;
