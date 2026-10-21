-- AI Fix (Admin › AI Fix and Settings › AI Settings), 21 October 2026.
-- The website also creates these tables by itself on first use
-- (ensureAiSchema in functions/api/_lib/claude.js); this file is for
-- `npx wrangler d1 migrations apply lobi-stars-tickets --remote`.
-- No existing table is changed.

-- Every call to Claude: what for, which model, tokens and estimated cost (US dollars).
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feature TEXT NOT NULL,              -- fix | batch_fix | weekly_scan | ask_claude | checklist_draft | code_proposal | weekly_summary | test
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost REAL NOT NULL DEFAULT 0,
  admin_id TEXT,
  related_id TEXT,
  success INTEGER NOT NULL DEFAULT 1,
  error_message TEXT,
  month TEXT NOT NULL,                -- YYYY-MM in Lagos time (for the monthly budget)
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_month ON ai_usage_log (month);

-- Settings (key/value): monthly_budget, warn_at_percent, auto_apply_enabled, auto_apply_types,
-- model_<feature>, weekly_scan_day, weekly_scan_time, max_items_per_batch, ask_claude_enabled,
-- price_<model>_in / price_<model>_out (US$ per million tokens), plus internal markers.
CREATE TABLE IF NOT EXISTS ai_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT,
  updated_by TEXT
);

-- One row per Analytics recommendation (its id, e.g. "ctr:/tickets/"): category, status and the prepared fix.
CREATE TABLE IF NOT EXISTS ai_recommendation_meta (
  rec_id TEXT PRIMARY KEY,
  rec_type TEXT NOT NULL,
  title TEXT,
  category TEXT NOT NULL,             -- auto_fix | input_needed | manual_only
  risk TEXT NOT NULL,                 -- low | normal | high
  fix_type TEXT,                      -- a whitelisted fix action, or NULL
  priority_score INTEGER NOT NULL DEFAULT 0,
  estimated_minutes INTEGER,
  status TEXT NOT NULL DEFAULT 'open', -- open | preparing | awaiting_input | awaiting_approval | applied | verified | failed | undone | dismissed
  data_hash TEXT,                     -- the facts the proposal was made from (no second Claude call for the same facts)
  input_json TEXT,                    -- what staff typed in (input_needed)
  proposal_json TEXT,                 -- Claude's checked proposal
  applied_json TEXT,                  -- what was changed and the previous values (for Undo)
  error TEXT,
  present INTEGER NOT NULL DEFAULT 1, -- 1 while the recommendation is still shown on Analytics
  last_checked_at TEXT,
  updated_at TEXT,
  updated_by TEXT
);

-- Message Batches sent to Anthropic (cheaper, results within 24 hours).
CREATE TABLE IF NOT EXISTS ai_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anthropic_id TEXT NOT NULL UNIQUE,
  feature TEXT NOT NULL,
  model TEXT NOT NULL,
  items_json TEXT NOT NULL,           -- [{ customId, recId, fixType, hash }]
  status TEXT NOT NULL DEFAULT 'in_progress', -- in_progress | ended | failed
  created_by TEXT,
  created_at TEXT NOT NULL,
  ended_at TEXT
);
