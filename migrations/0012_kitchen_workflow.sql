-- MatchDay Kitchen order workflow, Phase 1 (6 November 2026): venues, the order history,
-- refund records, Super Admin alert levels, and new columns. Nothing is dropped or renamed.
-- The website also creates all of this by itself on first use (ensureFoodSchema in
-- functions/api/_lib/foodOrders.js, ensureKitchenSchema in matchdayKitchen.js and
-- kitchenNotify.js); this file is for
-- `npx wrangler d1 migrations apply lobi-stars-tickets --remote`.
CREATE TABLE IF NOT EXISTS mk_venues (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  settings_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT);
INSERT OR IGNORE INTO mk_venues (id, name, active, settings_json, created_at) VALUES
  ('venue-main', 'McCarthy Stadium', 1, '{"whatsappNumber":"2347080094985","bankDetails":"Aeson Sports Management Limited, Fidelity Bank: 4011459917"}', '2026-11-06T00:00:00.000Z');

-- Every status change, by whom and why (only ever added to). kind: status / flag.
CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'status',
  from_status TEXT, to_status TEXT, by_id TEXT, by_name TEXT, by_role TEXT, reason TEXT, note TEXT,
  at TEXT NOT NULL, ack_at TEXT, ack_by TEXT);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events (order_id, id);
CREATE INDEX IF NOT EXISTS idx_order_events_flag ON order_events (kind, ack_at);

-- Paid orders that were rejected or cancelled. status: manual (to be refunded in Paystack by hand).
CREATE TABLE IF NOT EXISTS food_refunds (
  order_id TEXT PRIMARY KEY, amount_kobo INTEGER NOT NULL, reason TEXT, status TEXT NOT NULL DEFAULT 'manual',
  created_by TEXT, created_at TEXT NOT NULL, done_by TEXT, done_at TEXT);

-- What each Super Admin hears: all / urgent / off. Nobody else has a row: staff on duty can't mute.
CREATE TABLE IF NOT EXISTS mk_alert_prefs (user_id TEXT PRIMARY KEY, level TEXT NOT NULL, updated_at TEXT);

ALTER TABLE food_orders ADD COLUMN venue_id TEXT;
ALTER TABLE food_orders ADD COLUMN ready_at TEXT;
ALTER TABLE food_orders ADD COLUMN failed_at TEXT;
ALTER TABLE food_orders ADD COLUMN reject_reason TEXT;
ALTER TABLE food_orders ADD COLUMN reject_note TEXT;
ALTER TABLE food_orders ADD COLUMN cancel_reason TEXT;
UPDATE food_orders SET venue_id = 'venue-main' WHERE venue_id IS NULL;
ALTER TABLE mk_staff ADD COLUMN venue_id TEXT;
ALTER TABLE mk_shifts ADD COLUMN venue_id TEXT;
ALTER TABLE mk_activity ADD COLUMN before_json TEXT;
ALTER TABLE mk_activity ADD COLUMN after_json TEXT;
ALTER TABLE food_notification_log ADD COLUMN event TEXT;
ALTER TABLE food_notification_log ADD COLUMN recipient TEXT;
ALTER TABLE food_notification_log ADD COLUMN opened_at TEXT;
