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

CREATE INDEX IF NOT EXISTS idx_orders_event ON orders(event_id);
CREATE INDEX IF NOT EXISTS idx_tickets_order ON tickets(order_id);
CREATE INDEX IF NOT EXISTS idx_tickets_event ON tickets(event_id);

-- Seed a couple of example events so /api/events isn't empty on first deploy.
-- Edit dates/teams/prices to match real fixtures, or delete these rows.
INSERT OR IGNORE INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo, active) VALUES
  ('evt-sample-1', 'Lobi Stars', 'Kano Pillars', 'NPFL', '2026-08-15T15:00:00Z', 'Aper Aku Stadium, Makurdi', 500000, 250000, 100000, 1),
  ('evt-sample-2', 'Lobi Stars', 'Plateau United', 'NPFL', '2026-08-29T15:00:00Z', 'Aper Aku Stadium, Makurdi', 500000, 250000, 100000, 1);
