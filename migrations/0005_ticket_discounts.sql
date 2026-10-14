-- Ticket discounts: Group, Early bird and Family bundle (Admin › Tickets › Discounts).
-- All three rules are seeded OFF; nothing changes for fans until the admin
-- switches a rule on.
--
-- Safe to run more than once, before or after the deploy:
--   npx wrangler d1 migrations apply lobi-stars-tickets --local
--   npx wrangler d1 migrations apply lobi-stars-tickets --remote
--
-- The new COLUMNS are added by the site itself the first time the tickets
-- pages or the admin load (functions/api/_lib/ticketDiscounts.js,
-- ensureDiscountSchema), because SQLite cannot "ADD COLUMN IF NOT EXISTS" and
-- a second ALTER would make this migration fail. They are:
--   league_ticket_orders: subtotal_kobo, discount_kobo, discount_rule_id,
--     discount_label, discount_snapshot_json, group_name
--   orders:  ticket_type ('adult' | 'child'), discount_kobo, discount_rule_ids, discounted_qty
--   tickets: ticket_type ('adult' | 'child'), unit_price_kobo, discount_kobo
--   league_ticket_settings: allow_discounts (default 1), discount_cap
-- Global settings live in the settings table (keys tickets_discount_*):
--   allow stacking 0, most discount in total 2500 bp (25%), lowest ticket
--   price 0 kobo, group/family orders per email per match 1.

CREATE TABLE IF NOT EXISTS league_ticket_discount_rules (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('group', 'early_bird', 'family')),
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  percent_bp INTEGER NOT NULL DEFAULT 0,          -- basis points: 1000 = 10.00%
  valid_from TEXT, valid_until TEXT,              -- UTC ISO, NULL = no limit
  config_json TEXT NOT NULL DEFAULT '{}',
  max_discounted_tickets_per_match INTEGER,       -- NULL = no limit
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), updated_by TEXT
);

CREATE TABLE IF NOT EXISTS league_ticket_group_tiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT NOT NULL,
  min_tickets INTEGER NOT NULL,
  percent_bp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_league_ticket_group_tiers_rule ON league_ticket_group_tiers (rule_id);

-- Seeds (all OFF). Existing rules are never changed.
INSERT OR IGNORE INTO league_ticket_discount_rules (id, kind, name, is_active, percent_bp, config_json, updated_by)
  VALUES ('group', 'group', 'Group discount', 0, 0, '{}', 'setup');
INSERT OR IGNORE INTO league_ticket_discount_rules (id, kind, name, is_active, percent_bp, config_json, updated_by)
  VALUES ('early_bird', 'early_bird', 'Early bird', 0, 1000, '{"daysBefore":7}', 'setup');
INSERT OR IGNORE INTO league_ticket_discount_rules (id, kind, name, is_active, percent_bp, config_json, updated_by)
  VALUES ('family', 'family', 'Family bundle', 0, 1500, '{"minAdults":1,"maxAdults":2,"minChildren":1,"maxChildren":4,"childMaxAge":16}', 'setup');
-- Group tiers 10 to 19 tickets: 10%; 20 or more: 15% (only if the group rule has none yet).
INSERT INTO league_ticket_group_tiers (rule_id, min_tickets, percent_bp)
  SELECT r, m, p FROM (SELECT 'group' AS r, 10 AS m, 1000 AS p UNION ALL SELECT 'group', 20, 1500)
  WHERE NOT EXISTS (SELECT 1 FROM league_ticket_group_tiers WHERE rule_id = 'group');
