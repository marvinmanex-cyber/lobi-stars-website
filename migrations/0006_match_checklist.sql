-- Match Checklist (Admin › Matchday › Match Checklist).
--
-- The site also creates these tables itself the first time the checklist is
-- used (functions/api/_lib/matchChecklist.js, ensureChecklistSchema), and adds
-- the default template with its 33 tasks if no template exists yet.
-- Safe to run more than once, before or after the deploy:
--   npx wrangler d1 migrations apply lobi-stars-tickets --local
--   npx wrangler d1 migrations apply lobi-stars-tickets --remote
-- Nothing in the existing tables is changed.

CREATE TABLE IF NOT EXISTS checklist_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  venue_type TEXT NOT NULL DEFAULT 'both',      -- home | away | both
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checklist_template_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES checklist_templates(id),
  title TEXT NOT NULL,
  description TEXT,
  phase TEXT NOT NULL,                           -- before | during | after
  due_offset_minutes INTEGER NOT NULL DEFAULT 0, -- relative to kick-off: -7200 = 5 days before, 1440 = 1 day after
  remind_from_offset_minutes INTEGER,            -- optional: reminders start then instead of N days before
  default_owner_role_or_unit TEXT,               -- e.g. Media, Technical, Admin, Medical
  priority TEXT NOT NULL DEFAULT 'normal',       -- normal | critical
  applies_to TEXT NOT NULL DEFAULT 'both',       -- home | away | both
  sort_order INTEGER NOT NULL DEFAULT 0,
  link_type TEXT,                                -- internal | external | none ("Go to task" link)
  link_route TEXT,                               -- admin page pattern with placeholders, e.g. /admin/match-centre/?id={match_id}
  link_params TEXT,                              -- optional JSON
  link_url TEXT,                                 -- external https:// address
  link_label TEXT,                               -- button text (default "Go to task")
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- match_id = events.id, without a foreign key on purpose: deleting a match from
-- the fixtures must not be blocked by its checklist (it is closed, not deleted).
CREATE TABLE IF NOT EXISTS match_checklists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT NOT NULL UNIQUE,
  template_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active',         -- active | awaiting_closeout | closed
  kickoff_at TEXT NOT NULL,                      -- the kick-off the due times were worked out from
  is_home INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  closed_by TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS match_checklist_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_checklist_id INTEGER NOT NULL REFERENCES match_checklists(id),
  template_task_id INTEGER,
  title TEXT NOT NULL,
  description TEXT,
  phase TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  due_offset_minutes INTEGER NOT NULL DEFAULT 0,
  remind_from_offset_minutes INTEGER,
  due_at TEXT NOT NULL,                          -- kick-off + due_offset_minutes (ISO UTC)
  remind_from_at TEXT,
  owner_admin_id TEXT,
  owner_unit TEXT,
  status TEXT NOT NULL DEFAULT 'not_started',    -- not_started | in_progress | submitted_for_review | done | not_applicable
  notes TEXT,
  attachment_path TEXT,                          -- private R2 key (random name)
  attachment_name TEXT,
  completed_by TEXT,
  completed_by_name TEXT,
  completed_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  link_type TEXT,                                -- internal | external | none ("Go to task" link)
  link_route TEXT,                               -- admin page pattern with placeholders, e.g. /admin/match-centre/?id={match_id}
  link_params TEXT,                              -- optional JSON
  link_url TEXT,                                 -- external https:// address
  link_label TEXT,                               -- button text (default "Go to task")
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mct_checklist ON match_checklist_tasks (match_checklist_id, phase, due_at);

CREATE TABLE IF NOT EXISTS checklist_activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_checklist_task_id INTEGER,
  match_checklist_id INTEGER,
  admin_id TEXT,
  admin_name TEXT,
  action TEXT NOT NULL,                          -- status_changed | note_added | file_uploaded | owner_changed | unticked | closed | emailed | ...
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cal_task ON checklist_activity_log (match_checklist_task_id, id);

-- reminder_send_time, reminder_days_before, post_match_reminder_days,
-- recipient_mode, extra_recipient_emails, reminders_enabled, last_sent_date
CREATE TABLE IF NOT EXISTS checklist_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by TEXT);

-- One row per recipient per day: the daily digest is never sent twice.
CREATE TABLE IF NOT EXISTS checklist_reminder_log (
  day TEXT NOT NULL,
  email TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  tasks INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  PRIMARY KEY (day, email)
);
