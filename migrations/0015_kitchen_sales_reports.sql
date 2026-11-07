-- MatchDay Kitchen saved sales reports (7 November 2026): one per venue per day, with its own figures.
-- The website also creates this by itself on first use (ensureSalesReports in kitchenSalesReports.js).
CREATE TABLE IF NOT EXISTS food_sales_reports (report_no INTEGER PRIMARY KEY AUTOINCREMENT, venue_id TEXT NOT NULL, day TEXT NOT NULL, title TEXT NOT NULL, event_id TEXT, data_json TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT, updated_at TEXT, updated_by TEXT, UNIQUE (venue_id, day));
CREATE INDEX IF NOT EXISTS idx_sales_reports_day ON food_sales_reports (day);
