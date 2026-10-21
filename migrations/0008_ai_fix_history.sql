-- AI Fix, part 2 (22 October 2026): Fix history, Fix results, code proposals
-- and checklist drafts. The website also creates these tables by itself on
-- first use (claude.js, codeProposal.js, checklistDraft.js); this file is for
-- `npx wrangler d1 migrations apply lobi-stars-tickets --remote`.
-- No existing table is changed. (The Inbox's deleted_at / deleted_by columns
-- are added by the code: SQLite can't "ADD COLUMN IF NOT EXISTS".)

-- Every step of every fix (prepared, edited, applied, undone, verified…) and every AI email.
CREATE TABLE IF NOT EXISTS ai_fix_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rec_id TEXT, fix_type TEXT, action TEXT NOT NULL,
  admin_id TEXT, admin_name TEXT, detail TEXT,
  before_json TEXT, after_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_fix_log_rec ON ai_fix_log (rec_id, id);

-- The figure each applied fix was meant to improve: when applied, after 14 and 30 days.
CREATE TABLE IF NOT EXISTS ai_fix_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rec_id TEXT NOT NULL, fix_type TEXT, title TEXT, applied_at TEXT NOT NULL,
  metric TEXT, before_json TEXT,
  after14_json TEXT, after14_at TEXT, after30_json TEXT, after30_at TEXT,
  verdict TEXT                         -- better | worse | no change
);

-- Code proposals (Super Admins): saved on an ai-proposal/ branch, never on the live site.
CREATE TABLE IF NOT EXISTS ai_code_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rec_id TEXT, path TEXT NOT NULL, request TEXT, summary TEXT, edits_json TEXT,
  new_text TEXT, file_sha TEXT, branch TEXT, commit_id TEXT, pr_url TEXT, note TEXT,
  status TEXT NOT NULL DEFAULT 'proposed', created_by TEXT, created_at TEXT NOT NULL
);

-- Match Checklist "Draft with Claude": the last draft per writing task.
CREATE TABLE IF NOT EXISTS ai_checklist_drafts (
  task_id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,                  -- news | social
  facts_hash TEXT, staff_facts TEXT, question TEXT,
  proposal_json TEXT, saved_json TEXT,
  updated_at TEXT, updated_by TEXT
);
