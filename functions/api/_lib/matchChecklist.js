// Match Checklist (Admin › Matchday › Match Checklist).
//
// A reusable master template of tasks (Before / During / After the match), each
// with a due time relative to kick-off. For every upcoming Lobi Stars match a
// checklist is generated: the template's tasks are COPIED, so later template
// edits never change a current or past checklist. All admins can view and work
// on tasks; only Super Admins can tick a task done (enforced on the server, in
// functions/api/admin/match-checklist/). Every action is logged. Daily digest
// reminders: functions/api/internal/checklist-run.js (the every-minute Worker).
//
// Times are stored as ISO UTC strings and shown in Africa/Lagos time (UTC+1,
// no daylight saving). Database: tables created here on first use, the same
// SQL in migrations/0006_match_checklist.sql.
import { isHomeGame } from './matchCentre.js';
import { matchSlug } from './matchSlug.js';

export const PHASES = ['before', 'during', 'after'];
export const PHASE_LABEL = { before: 'Before the match', during: 'During the match', after: 'After the match' };
export const STATUSES = ['not_started', 'in_progress', 'submitted_for_review', 'done', 'not_applicable'];
export const STATUS_LABEL = { not_started: 'Not started', in_progress: 'In progress', submitted_for_review: 'Submitted for review', done: 'Done', not_applicable: 'Not applicable' };
export const CLOSED_TASK = new Set(['done', 'not_applicable']);
export const SETTINGS_DEFAULTS = {
  reminder_send_time: '08:00', reminder_days_before: '3', post_match_reminder_days: '3',
  recipient_mode: 'all_admins', extra_recipient_emails: '', reminders_enabled: '1', last_sent_date: '',
};
const WAT_MS = 3600e3;
const DAY_MS = 864e5;
export const GENERATE_WITHIN_DAYS = 14;
export const CLOSEOUT_AFTER_MIN = 180;

// ── Times (Africa/Lagos) ──
export const lagosDay = (ms = Date.now()) => new Date(ms + WAT_MS).toISOString().slice(0, 10);
export const lagosHHMM = (ms = Date.now()) => new Date(ms + WAT_MS).toISOString().slice(11, 16);
const pad = n => String(n).padStart(2, '0');
export function fmtLagos(iso, { date = true, time = true } = {}) {
  if (!iso) return '';
  const d = new Date(Date.parse(iso) + WAT_MS);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const ds = `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const ts = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return date && time ? `${ds}, ${ts}` : date ? ds : ts;
}
export const addMinutes = (iso, min) => new Date(Date.parse(iso) + Number(min) * 60000).toISOString();

/** -7200 → "5 days before kick-off", 0 → "At kick-off", 1440 → "1 day after kick-off". */
export function offsetLabel(min) {
  const m = Number(min) || 0;
  if (m === 0) return 'At kick-off';
  const a = Math.abs(m), side = m < 0 ? 'before' : 'after';
  const unit = a % 1440 === 0 ? [a / 1440, 'day'] : a % 60 === 0 ? [a / 60, 'hour'] : [a, 'minute'];
  return `${unit[0]} ${unit[1]}${unit[0] === 1 ? '' : 's'} ${side} kick-off`;
}
/** { amount, unit: 'minutes'|'hours'|'days', when: 'before'|'after'|'at' } → minutes (relative to kick-off). */
export function toOffset({ amount, unit, when }) {
  if (when === 'at') return 0;
  const n = Math.max(0, Math.round(Number(amount) || 0));
  const mult = { minutes: 1, hours: 60, days: 1440 }[unit] || 1;
  return (when === 'before' ? -1 : 1) * n * mult;
}

// ── Schema ──
let ready = false;
export async function ensureChecklistSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS checklist_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, venue_type TEXT NOT NULL DEFAULT 'both',
      is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS checklist_template_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER NOT NULL REFERENCES checklist_templates(id),
      title TEXT NOT NULL, description TEXT, phase TEXT NOT NULL, due_offset_minutes INTEGER NOT NULL DEFAULT 0,
      remind_from_offset_minutes INTEGER, default_owner_role_or_unit TEXT, priority TEXT NOT NULL DEFAULT 'normal',
      applies_to TEXT NOT NULL DEFAULT 'both', sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS match_checklists (
      -- match_id = events.id, deliberately without a foreign key: a match deleted from the
      -- fixtures must not be blocked by its checklist (the checklist is closed, never deleted).
      id INTEGER PRIMARY KEY AUTOINCREMENT, match_id TEXT NOT NULL UNIQUE, template_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active', kickoff_at TEXT NOT NULL, is_home INTEGER NOT NULL DEFAULT 1, note TEXT,
      closed_by TEXT, closed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS match_checklist_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, match_checklist_id INTEGER NOT NULL REFERENCES match_checklists(id),
      template_task_id INTEGER, title TEXT NOT NULL, description TEXT, phase TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'normal',
      due_offset_minutes INTEGER NOT NULL DEFAULT 0, remind_from_offset_minutes INTEGER,
      due_at TEXT NOT NULL, remind_from_at TEXT, owner_admin_id TEXT, owner_unit TEXT,
      status TEXT NOT NULL DEFAULT 'not_started', notes TEXT, attachment_path TEXT, attachment_name TEXT,
      completed_by TEXT, completed_by_name TEXT, completed_at TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_mct_checklist ON match_checklist_tasks (match_checklist_id, phase, due_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS checklist_activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, match_checklist_task_id INTEGER, match_checklist_id INTEGER,
      admin_id TEXT, admin_name TEXT, action TEXT NOT NULL, old_value TEXT, new_value TEXT, reason TEXT, created_at TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cal_task ON checklist_activity_log (match_checklist_task_id, id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS checklist_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS checklist_reminder_log (
      day TEXT NOT NULL, email TEXT NOT NULL, sent_at TEXT NOT NULL, tasks INTEGER NOT NULL DEFAULT 0, ok INTEGER NOT NULL DEFAULT 0, error TEXT,
      PRIMARY KEY (day, email))`),
  ]);
  // "Go to task" links (added later; columns added if missing).
  for (const table of ['checklist_template_tasks', 'match_checklist_tasks']) {
    const have = new Set((await db.prepare(`PRAGMA table_info(${table})`).all()).results.map(r => r.name));
    for (const [col, type] of LINK_COLUMNS) if (!have.has(col)) await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run();
  }
  const has = await db.prepare(`SELECT COUNT(*) AS n FROM checklist_templates`).first();
  if (!has.n) await seedDefaultTemplate(db);
  // Template tasks that have never had a link set (NULL, not 'none') get the seed task's link.
  const { results: unset } = await db.prepare(`SELECT id, title FROM checklist_template_tasks WHERE link_type IS NULL`).all();
  if (unset.length) {
    await db.batch(unset.map(t => {
      const l = SEED_LINKS[t.title] || { type: 'none' };
      return db.prepare(`UPDATE checklist_template_tasks SET link_type = ?, link_route = ?, link_label = ? WHERE id = ?`).bind(l.type, l.route || null, l.label || null, t.id);
    }));
  }
  ready = true;
}

// ── "Go to task" links ──
// link_type internal | external | none; link_route: an admin page pattern with
// placeholders (built when shown, so a changed page address never leaves a
// stale stored link); link_url: an https:// address for external links.
export const LINK_COLUMNS = [['link_type', 'TEXT'], ['link_route', 'TEXT'], ['link_params', 'TEXT'], ['link_url', 'TEXT'], ['link_label', 'TEXT']];
export const PLACEHOLDERS = ['match_id', 'fixture_id', 'home_team', 'away_team', 'match_date', 'competition_id', 'season_id', 'opponent_id', 'match_slug', 'site_url'];
const news = (type, category = 'First Team', title = '{home_team}%20vs%20{away_team}') =>
  `/admin/#/collections/news/new?title=${encodeURIComponent(`${type}: `)}${title}&category=${encodeURIComponent(category)}&contentType=${encodeURIComponent(type)}&matchDate={match_date}`;
/** The admin pages a task can link to (Templates page drop-down). Paths must exist. */
export const LINK_TARGETS = [
  { id: 'live-match', label: 'Live Match Control (this match)', route: '/admin/match-centre/?id={match_id}' },
  { id: 'live-timeline', label: 'Live Match Control: live timeline', route: '/admin/match-centre/?id={match_id}#mc-timeline' },
  { id: 'live-squad', label: 'Live Match Control: matchday squad', route: '/admin/match-centre/?id={match_id}#squadSet' },
  { id: 'live-lineups', label: 'Live Match Control: line-ups', route: '/admin/match-centre/?id={match_id}#mc-lineups' },
  { id: 'live-stats', label: 'Live Match Control: stats', route: '/admin/match-centre/?id={match_id}#mc-stats' },
  { id: 'live-gallery', label: 'Live Match Control: gallery', route: '/admin/match-centre/?id={match_id}#mc-gallery' },
  { id: 'live-stream', label: 'Live Match Control: Watch Live / highlights links', route: '/admin/match-centre/?id={match_id}#streamSet' },
  { id: 'league-fixtures', label: 'League › Fixtures (dates, kick-off, venue)', route: '/admin/league/fixtures/' },
  { id: 'league-results', label: 'League › Results', route: '/admin/league/results/' },
  { id: 'match-settings', label: 'Match Tickets & Settings', route: '/admin/matches/' },
  { id: 'tickets', label: 'Tickets (sales, gate, refunds)', route: '/admin/tickets/' },
  { id: 'helpers', label: 'Matchday helpers (gate and kitchen logins)', route: '/admin/helpers/' },
  { id: 'programme', label: 'Matchday Programme', route: '/admin/programmes/' },
  { id: 'share-match', label: 'Share any page: this match page', route: '/admin/share/?url={site_url}/matches/{match_slug}/' },
  { id: 'fan-alerts', label: 'Fan Match Alerts', route: '/admin/fan-alerts/' },
  { id: 'commentary', label: 'Live Commentary', route: '/admin/commentary/' },
  { id: 'predictions', label: 'Predict & Win (this match)', route: '/admin/predictions/?id={match_id}' },
  { id: 'squad', label: 'Squad & Players (content editor)', route: '/admin/#/collections/players' },
  { id: 'news-new', label: 'News: new article', route: '/admin/#/collections/news/new' },
  { id: 'news-preview', label: 'News: new match preview', route: news('Preview') },
  { id: 'news-team', label: 'News: new team news', route: news('Team News', 'Team News') },
  { id: 'news-report', label: 'News: new match report', route: news('Match Report') },
  { id: 'news-highlights', label: 'News: new highlights post', route: news('Highlights') },
  { id: 'news-reaction', label: 'News: new reaction / interview', route: news('Reaction/Interview') },
  { id: 'gallery', label: 'Photo gallery (content editor)', route: '/admin/#/collections/gallery' },
  { id: 'food', label: 'Food orders (MatchDay Kitchen)', route: '/admin/food-orders/' },
  { id: 'analytics', label: 'Analytics', route: '/admin/analytics/' },
];
const route = id => LINK_TARGETS.find(t => t.id === id).route;
// The seed tasks' pages (see docs/match-checklist.md for the mapping and confidence).
export const SEED_LINKS = {
  'Confirm fixture details (date, kickoff, venue, broadcast)': { type: 'internal', route: route('league-fixtures'), label: 'Open fixtures' },
  'Player registration and eligibility check (suspensions, yellow card count, injuries)': { type: 'internal', route: route('squad'), label: 'Open squad' },
  'Match day program: content written': { type: 'internal', route: route('programme'), label: 'Open programme' },
  'Match day program: design approved and printed/published': { type: 'internal', route: route('programme'), label: 'Open programme' },
  'Ticketing and gate arrangements': { type: 'internal', route: route('tickets'), label: 'Open tickets' },
  'Social media countdown and preview posts': { type: 'internal', route: route('share-match'), label: 'Share the match page' },
  'Starting line-up graphic ready': { type: 'internal', route: route('live-lineups'), label: 'Open line-ups' },
  'Team sheet submitted': { type: 'internal', route: route('live-squad'), label: 'Open matchday squad' },
  'Live social media updates (line-up, goals, half-time, full-time)': { type: 'internal', route: route('live-timeline'), label: 'Open live timeline' },
  'Photography and video coverage': { type: 'internal', route: route('live-gallery'), label: 'Open match gallery' },
  'Match stats captured': { type: 'internal', route: route('live-stats'), label: 'Open match stats' },
  'Incident log (injuries, cards, crowd issues)': { type: 'internal', route: route('live-timeline'), label: 'Open live timeline' },
  'Full-time result posted': { type: 'internal', route: route('live-match'), label: 'Open Live Match Control' },
  'Post-match press conference / interviews': { type: 'internal', route: route('news-reaction'), label: 'Write the interview post' },
  'Match report published': { type: 'internal', route: route('news-report'), label: 'Write the match report' },
  'Highlights video uploaded': { type: 'internal', route: route('live-stream'), label: 'Add the highlights link' },
  'Injury report': { type: 'internal', route: route('news-team'), label: 'Write team news' },
  'Gate takings and expenses reconciled': { type: 'internal', route: route('tickets'), label: 'Open ticket sales' },
  'Thank-you post for fans and sponsors': { type: 'internal', route: route('share-match'), label: 'Share the match page' },
};
const KNOWN_PATHS = new Set(LINK_TARGETS.map(t => t.route.split(/[?#]/)[0]));

/** Values for the placeholders of one match (league ids when the match is a league fixture). */
export async function linkContext(env, db, match) {
  const ctx = {
    match_id: match.id, fixture_id: '', home_team: match.home || '', away_team: match.away || '', match_slug: match.slug || '',
    match_date: match.kickoff ? lagosDay(Date.parse(match.kickoff)) : '', competition_id: '', season_id: '', opponent_id: '',
    site_url: String(env.SITE_URL || 'https://lobistarsfc.com').replace(/\/+$/, ''),
  };
  try {
    const f = await db.prepare(`SELECT f.id, f.competition_id, f.home_team_id, f.away_team_id, c.season, h.name AS home_name
      FROM league_fixtures f LEFT JOIN league_competitions c ON c.id = f.competition_id LEFT JOIN league_teams h ON h.id = f.home_team_id
      WHERE f.event_id = ? LIMIT 1`).bind(match.id).first();
    if (f) {
      const club = new RegExp(String(env.CLUB_NAME || 'Lobi Stars').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      Object.assign(ctx, { fixture_id: f.id, competition_id: f.competition_id, season_id: f.season || '', opponent_id: club.test(f.home_name || '') ? f.away_team_id : f.home_team_id });
    }
  } catch { /* no league tables yet */ }
  return ctx;
}

/**
 * The task's link, built now from its route and the match's values, plus
 * ?from=checklist&task=<id> on internal links. Missing values make the link
 * "broken" (not shown). base: absolute links for emails and PDFs.
 */
export function buildTaskLink(task, ctx, { base = '' } = {}) {
  const label = task.link_label || 'Go to task';
  if (task.link_type === 'external') {
    const u = String(task.link_url || '').trim();
    return /^https:\/\/[^\s]+$/i.test(u) ? { type: 'external', url: fillPlaceholders(u, ctx).url, label } : null;
  }
  if (task.link_type !== 'internal' || !task.link_route) return null;
  const filled = fillPlaceholders(task.link_route, ctx);
  if (filled.missing.length || !filled.url.startsWith('/admin')) return { type: 'internal', broken: true, missing: filled.missing, label };
  // The tracking goes before any '#' (the content editor keeps its own address after it).
  const at = filled.url.indexOf('#');
  const pathQuery = at < 0 ? filled.url : filled.url.slice(0, at), hash = at < 0 ? '' : filled.url.slice(at);
  const params = `from=checklist&task=${encodeURIComponent(task.id)}`;
  return { type: 'internal', url: `${base}${pathQuery}${pathQuery.includes('?') ? '&' : '?'}${params}${hash}`, label };
}
/** Replaces {placeholders}; values are URL-encoded except {site_url}. */
export function fillPlaceholders(pattern, ctx) {
  const missing = [];
  const url = String(pattern).replace(/\{([a-z_]+)\}/g, (all, k) => {
    if (!PLACEHOLDERS.includes(k)) { missing.push(k); return all; }
    const v = ctx[k];
    if (v === undefined || v === null || v === '') { missing.push(k); return all; }
    return k === 'site_url' ? String(v) : encodeURIComponent(String(v));
  });
  return { url, missing };
}
/** Is this internal route a page that exists? (Daily broken-link check.) */
export function routeExists(routePattern) {
  const path = String(routePattern || '').split(/[?#]/)[0];
  return KNOWN_PATHS.has(path);
}

// Seed tasks: [phase, title, offset (minutes), owner, priority, applies_to]
const D = 1440, H = 60;
export const SEED_TASKS = [
  ['before', 'Confirm fixture details (date, kickoff, venue, broadcast)', -7 * D, 'Admin', 'critical', 'both'],
  ['before', 'Player registration and eligibility check (suspensions, yellow card count, injuries)', -5 * D, 'Admin', 'critical', 'both'],
  ['before', 'Opposition scouting and pre-match analysis report', -3 * D, 'Technical', 'critical', 'both'],
  ['before', 'Medical and fitness report', -2 * D, 'Medical', 'normal', 'both'],
  ['before', 'Match day program: content written', -4 * D, 'Media', 'normal', 'both'],
  ['before', 'Match day program: design approved and printed/published', -2 * D, 'Media', 'normal', 'both'],
  ['before', 'Travel booking (transport)', -5 * D, 'Admin', 'critical', 'away'],
  ['before', 'Hotel and feeding arrangements', -5 * D, 'Admin', 'critical', 'away'],
  ['before', 'Stadium inspection, pitch, dressing rooms, ball boys', -2 * D, 'Admin', 'critical', 'home'],
  ['before', 'Security and police liaison confirmed', -3 * D, 'Admin', 'critical', 'home'],
  ['before', 'Ticketing and gate arrangements', -3 * D, 'Admin', 'normal', 'home'],
  ["before", "Match officials' hosting per league rules", -2 * D, 'Admin', 'normal', 'home'],
  ['before', 'Media accreditation list', -3 * D, 'Media', 'normal', 'home'],
  ['before', 'Pre-match press conference', -1 * D, 'Media', 'normal', 'both'],
  ['before', 'Social media countdown and preview posts', -3 * D, 'Media', 'normal', 'both'],
  ['before', 'Kit check (colour clash, goalkeeper kits, spares)', -2 * D, 'Kit/Admin', 'critical', 'both'],
  ['before', 'Ambulance and medical team on standby confirmed', -1 * D, 'Medical', 'critical', 'home'],
  ['before', 'Starting line-up graphic ready', -2 * H, 'Media', 'normal', 'both'],
  ['before', 'Team sheet submitted', -90, 'Technical', 'critical', 'both'],
  ['during', 'Live social media updates (line-up, goals, half-time, full-time)', 0, 'Media', 'normal', 'both'],
  ['during', 'Photography and video coverage', 0, 'Media', 'normal', 'both'],
  ['during', 'Match stats captured', 0, 'Technical', 'normal', 'both'],
  ['during', 'Crowd and security monitoring', 0, 'Admin', 'normal', 'home'],
  ['during', 'Incident log (injuries, cards, crowd issues)', 0, 'Admin', 'normal', 'both'],
  ['after', 'Full-time result posted', 2 * H, 'Media', 'normal', 'both'],
  ['after', 'Post-match press conference / interviews', 2 * H, 'Media', 'normal', 'both'],
  ['after', 'Match report published', 1 * D, 'Media', 'normal', 'both'],
  ['after', 'Highlights video uploaded', 1 * D, 'Media', 'normal', 'both'],
  ['after', 'Post-match analysis and player performance review', 2 * D, 'Technical', 'normal', 'both'],
  ['after', 'Injury report', 1 * D, 'Medical', 'normal', 'both'],
  ['after', 'Gate takings and expenses reconciled', 2 * D, 'Admin', 'normal', 'home'],
  ['after', 'Disciplinary or incident reports filed with league (if any)', 2 * D, 'Admin', 'critical', 'both'],
  ['after', 'Thank-you post for fans and sponsors', 1 * D, 'Media', 'normal', 'both'],
];
async function seedDefaultTemplate(db) {
  const now = new Date().toISOString();
  const t = await db.prepare(`INSERT INTO checklist_templates (name, venue_type, is_active, created_at, updated_at) VALUES ('Default match checklist', 'both', 1, ?, ?) RETURNING id`).bind(now, now).first();
  await db.batch(SEED_TASKS.map(([phase, title, off, owner, prio, applies], i) => {
    const l = SEED_LINKS[title] || { type: 'none' };
    return db.prepare(`INSERT INTO checklist_template_tasks (template_id, title, phase, due_offset_minutes, default_owner_role_or_unit, priority, applies_to, sort_order, link_type, link_route, link_label, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(t.id, title, phase, off, owner, prio, applies, (i + 1) * 10, l.type, l.route || null, l.label || null, now, now);
  }));
}

// ── Settings ──
export async function getSettings(db) {
  await ensureChecklistSchema(db);
  const { results } = await db.prepare(`SELECT key, value FROM checklist_settings`).all();
  const s = { ...SETTINGS_DEFAULTS };
  for (const r of results) if (r.key in s && r.value !== null) s[r.key] = r.value;
  return {
    reminderSendTime: /^\d{2}:\d{2}$/.test(s.reminder_send_time) ? s.reminder_send_time : '08:00',
    reminderDaysBefore: Math.min(30, Math.max(0, Number(s.reminder_days_before) || 0)),
    postMatchReminderDays: Math.min(30, Math.max(0, Number(s.post_match_reminder_days) || 0)),
    recipientMode: s.recipient_mode === 'owners_plus_super_admins' ? 'owners_plus_super_admins' : 'all_admins',
    extraRecipientEmails: String(s.extra_recipient_emails || ''),
    remindersEnabled: s.reminders_enabled !== '0',
    lastSentDate: s.last_sent_date || '',
  };
}
export async function saveSetting(db, key, value, by) {
  await db.prepare(`INSERT INTO checklist_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .bind(key, String(value), new Date().toISOString(), by || null).run();
}
export const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;
export const parseEmails = s => [...new Set(String(s || '').split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(Boolean))];

// ── Activity log ──
export async function logActivity(db, { taskId = null, checklistId = null, admin, action, oldValue = null, newValue = null, reason = null }) {
  await db.prepare(`INSERT INTO checklist_activity_log (match_checklist_task_id, match_checklist_id, admin_id, admin_name, action, old_value, new_value, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(taskId, checklistId, admin?.id || 'system', admin?.name || 'Automatic', action,
    oldValue === null ? null : String(oldValue).slice(0, 500), newValue === null ? null : String(newValue).slice(0, 500), reason ? String(reason).slice(0, 500) : null, new Date().toISOString()).run();
}

// ── Generation (pure part, tested in tests/match-checklist.unit.test.mjs) ──

/** Template tasks → the rows of a new match checklist (applies_to filtered by home/away). */
export function tasksFromTemplate(templateTasks, kickoffIso, isHome) {
  const venue = isHome ? 'home' : 'away';
  return templateTasks
    .filter(t => t.applies_to === 'both' || t.applies_to === venue)
    .map(t => ({
      template_task_id: t.id ?? null, title: t.title, description: t.description || null, phase: t.phase, priority: t.priority || 'normal',
      due_offset_minutes: Number(t.due_offset_minutes) || 0,
      remind_from_offset_minutes: t.remind_from_offset_minutes === null || t.remind_from_offset_minutes === undefined || t.remind_from_offset_minutes === '' ? null : Number(t.remind_from_offset_minutes),
      due_at: addMinutes(kickoffIso, Number(t.due_offset_minutes) || 0),
      remind_from_at: t.remind_from_offset_minutes === null || t.remind_from_offset_minutes === undefined || t.remind_from_offset_minutes === '' ? null : addMinutes(kickoffIso, Number(t.remind_from_offset_minutes)),
      owner_unit: t.default_owner_role_or_unit || null, sort_order: Number(t.sort_order) || 0,
      link_type: ['internal', 'external'].includes(t.link_type) ? t.link_type : 'none', link_route: t.link_route || null,
      link_params: t.link_params || null, link_url: t.link_url || null, link_label: t.link_label || null,
    }));
}
/** New due and remind-from times after a kick-off change, for tasks that are not finished. */
export function rescheduledTimes(task, kickoffIso) {
  if (CLOSED_TASK.has(task.status)) return null;
  return {
    due_at: addMinutes(kickoffIso, task.due_offset_minutes),
    remind_from_at: task.remind_from_offset_minutes === null || task.remind_from_offset_minutes === undefined ? null : addMinutes(kickoffIso, task.remind_from_offset_minutes),
  };
}

const isClubMatch = (e, club) => {
  const re = new RegExp(String(club || 'Lobi Stars').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return e.is_home === 1 || e.is_home === 0 || re.test(e.home_team || '') || re.test(e.away_team || '');
};

/** The template for a match: its own venue's (home/away) if there is one, otherwise the shared one ("both"). */
export function pickTemplate(templates, isHome) {
  const venue = isHome ? 'home' : 'away';
  return templates.find(t => t.venue_type === venue) || templates.find(t => t.venue_type === 'both') || null;
}

/**
 * Keeps checklists in step with the fixtures (called by the daily job, the
 * timer, fixture saves and the checklist page). Generates checklists for the
 * next Lobi Stars match and any within 14 days; moves due times when kick-off
 * changes; marks "awaiting close-out" 3 hours after kick-off (or at full time);
 * closes checklists whose match was cancelled or removed. Returns what it did.
 */
export async function syncChecklists(env, { now = Date.now() } = {}) {
  const db = env.DB;
  await ensureChecklistSchema(db);
  const club = env.CLUB_NAME || 'Lobi Stars';
  const done = { generated: [], rescheduled: [], awaiting: [], closed: [], autoSubmitted: 0 };
  const hasCentre = !!(await db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'match_centre'`).first());
  const { results: events } = await db.prepare(
    `SELECT e.*, ${hasCentre ? 'm.status AS match_status' : 'NULL AS match_status'} FROM events e ${hasCentre ? 'LEFT JOIN match_centre m ON m.event_id = e.id' : ''}
     WHERE e.active = 1 AND e.event_date > ? ORDER BY e.event_date`).bind(new Date(now - 30 * DAY_MS).toISOString()).all();
  const clubEvents = events.filter(e => isClubMatch(e, club));
  const byId = new Map(clubEvents.map(e => [e.id, e]));
  const { results: lists } = await db.prepare(`SELECT * FROM match_checklists WHERE status != 'closed'`).all();
  const listed = new Set((await db.prepare(`SELECT match_id FROM match_checklists`).all()).results.map(r => r.match_id));
  const nowIso = new Date(now).toISOString();

  // 1. Generate: the next upcoming match, and every match within 14 days.
  const upcoming = clubEvents.filter(e => Date.parse(e.event_date) > now && !['cancelled'].includes(e.match_status));
  const want = upcoming.filter((e, i) => i === 0 || Date.parse(e.event_date) - now <= GENERATE_WITHIN_DAYS * DAY_MS);
  // A home (or away) match uses the home (or away) template when there is one, otherwise the shared one.
  const { results: templates } = await db.prepare(`SELECT * FROM checklist_templates WHERE is_active = 1 ORDER BY id`).all();
  const taskCache = new Map();
  const tasksOf = async id => { if (!taskCache.has(id)) taskCache.set(id, (await db.prepare(`SELECT * FROM checklist_template_tasks WHERE template_id = ? ORDER BY sort_order, id`).bind(id).all()).results); return taskCache.get(id); };
  if (templates.length) {
    for (const e of want) {
      if (listed.has(e.id)) continue;
      const home = isHomeGame(e);
      const template = pickTemplate(templates, home);
      if (!template) continue;
      const tTasks = await tasksOf(template.id);
      const created = await db.prepare(`INSERT INTO match_checklists (match_id, template_id, status, kickoff_at, is_home, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?, ?)
        ON CONFLICT (match_id) DO NOTHING RETURNING id`).bind(e.id, template.id, e.event_date, home ? 1 : 0, nowIso, nowIso).first();
      if (!created) continue; // made by another request at the same moment
      const rows = tasksFromTemplate(tTasks, e.event_date, home);
      for (let i = 0; i < rows.length; i += 40) {
        await db.batch(rows.slice(i, i + 40).map(r => db.prepare(`INSERT INTO match_checklist_tasks
          (match_checklist_id, template_task_id, title, description, phase, priority, due_offset_minutes, remind_from_offset_minutes, due_at, remind_from_at, owner_unit, status, sort_order,
           link_type, link_route, link_params, link_url, link_label, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_started', ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(created.id, r.template_task_id, r.title, r.description, r.phase, r.priority, r.due_offset_minutes, r.remind_from_offset_minutes, r.due_at, r.remind_from_at, r.owner_unit, r.sort_order,
            r.link_type, r.link_route, r.link_params, r.link_url, r.link_label, nowIso, nowIso)));
      }
      await logActivity(db, { checklistId: created.id, action: 'generated', newValue: `${e.home_team} vs ${e.away_team} (${rows.length} tasks)` });
      done.generated.push(created.id);
    }
  }

  // 2. Existing open checklists: reschedule, close-out, cancel.
  for (const l of lists) {
    const e = byId.get(l.match_id) || await db.prepare(`SELECT e.*, ${hasCentre ? 'm.status AS match_status' : 'NULL AS match_status'} FROM events e ${hasCentre ? 'LEFT JOIN match_centre m ON m.event_id = e.id' : ''} WHERE e.id = ?`).bind(l.match_id).first();
    if (!e || e.active === 0 || e.match_status === 'cancelled') {
      const note = !e ? 'Match removed from the fixtures' : e.match_status === 'cancelled' ? 'Match cancelled' : 'Match hidden from the fixtures';
      await db.prepare(`UPDATE match_checklists SET status = 'closed', note = ?, closed_by = 'system', closed_at = ?, updated_at = ? WHERE id = ?`).bind(note, nowIso, nowIso, l.id).run();
      await logActivity(db, { checklistId: l.id, action: 'closed', newValue: note });
      done.closed.push(l.id);
      continue;
    }
    if (e.event_date !== l.kickoff_at) {
      const { results: tasks } = await db.prepare(`SELECT id, status, due_offset_minutes, remind_from_offset_minutes FROM match_checklist_tasks WHERE match_checklist_id = ?`).bind(l.id).all();
      const stmts = [];
      for (const t of tasks) {
        const nt = rescheduledTimes(t, e.event_date);
        if (nt) stmts.push(db.prepare(`UPDATE match_checklist_tasks SET due_at = ?, remind_from_at = ?, updated_at = ? WHERE id = ?`).bind(nt.due_at, nt.remind_from_at, nowIso, t.id));
      }
      stmts.push(db.prepare(`UPDATE match_checklists SET kickoff_at = ?, status = CASE WHEN status = 'awaiting_closeout' AND ? > ? THEN 'active' ELSE status END, updated_at = ? WHERE id = ?`)
        .bind(e.event_date, Date.parse(e.event_date) + CLOSEOUT_AFTER_MIN * 60000, now, nowIso, l.id));
      for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
      await logActivity(db, { checklistId: l.id, action: 'rescheduled', oldValue: l.kickoff_at, newValue: e.event_date });
      done.rescheduled.push(l.id);
      l.kickoff_at = e.event_date;
    }
    if (l.status === 'active' && (now >= Date.parse(l.kickoff_at) + CLOSEOUT_AFTER_MIN * 60000 || e.match_status === 'full-time')) {
      await db.prepare(`UPDATE match_checklists SET status = 'awaiting_closeout', updated_at = ? WHERE id = ? AND status = 'active'`).bind(nowIso, l.id).run();
      await logActivity(db, { checklistId: l.id, action: 'awaiting_closeout' });
      done.awaiting.push(l.id);
    }
    try { done.autoSubmitted += await autoSubmit(db, l, nowIso, now); } catch (err) { console.error('[checklist] auto submit', err); }
  }
  return done;
}

// ── Automatic "Submitted for review" (never Done: a Super Admin still ticks) ──

/** Does a saved JSON field hold anything real? (Empty lists, blanks and zero counts don't count.) */
export function hasData(s) {
  let v;
  try { v = typeof s === 'string' ? JSON.parse(s) : s; } catch { return false; }
  const real = x => x === null || x === undefined ? false
    : typeof x === 'number' ? x > 0
    : typeof x === 'string' ? x.trim() !== ''
    : typeof x === 'boolean' ? x
    : Array.isArray(x) ? x.some(real) : Object.values(x).some(real);
  return real(v);
}
/**
 * Seed tasks the website can see are done, from Live Match Control and the
 * Matchday Programme. Returns { title: why }. Tasks renamed in Templates are
 * no longer recognised (they just stay manual).
 */
export function autoChecks({ centre = null, programme = null, kickoffMs, now = Date.now() }) {
  const out = {}, started = now >= kickoffMs;
  if (programme?.pdf_key) out['Match day program: content written'] = 'The programme PDF is uploaded';
  if (['published', 'scheduled'].includes(programme?.status)) out['Match day program: design approved and printed/published'] = programme.status === 'published' ? 'The programme is published' : 'The programme is scheduled to publish';
  if (!centre) return out;
  if (hasData(centre.lineups_json)) out['Starting line-up graphic ready'] = 'Line-ups are saved in Live Match Control';
  if (hasData(centre.squad_json)) out['Team sheet submitted'] = 'The matchday squad is saved in Live Match Control';
  if (started && hasData(centre.stats_json)) out['Match stats captured'] = 'Match stats are entered in Live Match Control';
  if (started && hasData(centre.gallery_json)) out['Photography and video coverage'] = 'Photos are in the match gallery';
  if (centre.status === 'full-time' && centre.home_score !== null && centre.home_score !== undefined && centre.away_score !== null && centre.away_score !== undefined) out['Full-time result posted'] = `Full time recorded (${centre.home_score}-${centre.away_score})`;
  if (started && String(centre.report || '').trim().length >= 80) out['Match report published'] = 'A match report is saved in Live Match Control';
  return out;
}
/** Applies autoChecks to one open checklist. Returns how many tasks it moved. */
async function autoSubmit(db, l, nowIso, now) {
  const { results: open } = await db.prepare(`SELECT id, title, status FROM match_checklist_tasks WHERE match_checklist_id = ? AND status IN ('not_started', 'in_progress')`).bind(l.id).all();
  if (!open.length) return 0;
  let centre = null, programme = null;
  try { centre = await db.prepare(`SELECT * FROM match_centre WHERE event_id = ?`).bind(l.match_id).first(); } catch {}
  try {
    const day = lagosDay(Date.parse(l.kickoff_at));
    const { results } = await db.prepare(`SELECT status, pdf_key, kickoff_at FROM programmes WHERE kickoff_at BETWEEN ? AND ? ORDER BY id DESC`)
      .bind(new Date(Date.parse(l.kickoff_at) - DAY_MS).toISOString(), new Date(Date.parse(l.kickoff_at) + DAY_MS).toISOString()).all();
    programme = results.find(p => p.kickoff_at && lagosDay(Date.parse(p.kickoff_at)) === day) || null;
  } catch {}
  const why = autoChecks({ centre, programme, kickoffMs: Date.parse(l.kickoff_at), now });
  let n = 0;
  for (const t of open) {
    if (!why[t.title]) continue;
    const u = await db.prepare(`UPDATE match_checklist_tasks SET status = 'submitted_for_review', updated_at = ? WHERE id = ? AND status IN ('not_started', 'in_progress')`).bind(nowIso, t.id).run();
    if (!u.meta?.changes) continue;
    await logActivity(db, { taskId: t.id, checklistId: l.id, action: 'status_changed', oldValue: t.status, newValue: 'submitted_for_review', reason: `Automatic: ${why[t.title]}` });
    n++;
  }
  return n;
}

/** Closes a checklist when every task is done or not applicable. */
export async function closeIfComplete(db, checklistId, admin) {
  const r = await db.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN status IN ('done', 'not_applicable') THEN 1 ELSE 0 END) AS fin FROM match_checklist_tasks WHERE match_checklist_id = ?`).bind(checklistId).first();
  if (r.n && r.fin === r.n) {
    const nowIso = new Date().toISOString();
    const u = await db.prepare(`UPDATE match_checklists SET status = 'closed', note = 'All tasks finished', closed_by = ?, closed_at = ?, updated_at = ? WHERE id = ? AND status != 'closed'`)
      .bind(admin?.id || 'system', nowIso, nowIso, checklistId).run();
    if (u.meta?.changes) { await logActivity(db, { checklistId, admin, action: 'closed', newValue: 'All tasks finished' }); return true; }
  }
  return false;
}

// ── Reading ──

/** One checklist with its match, tasks (each with its "Go to task" link) and progress. base: absolute links (emails, PDFs). */
export async function loadChecklist(db, id, now = Date.now(), { env = {}, base = '' } = {}) {
  const l = await db.prepare(`SELECT * FROM match_checklists WHERE id = ?`).bind(id).first();
  if (!l) return null;
  const e = await db.prepare(`SELECT * FROM events WHERE id = ?`).bind(l.match_id).first();
  let matchday = null;
  try { matchday = (await db.prepare(`SELECT matchday FROM league_fixtures WHERE event_id = ? LIMIT 1`).bind(l.match_id).first())?.matchday ?? null; } catch {}
  const { results: tasks } = await db.prepare(`SELECT t.*, a.name AS owner_name, c.name AS closed_by_name
    FROM match_checklist_tasks t LEFT JOIN admin_users a ON a.id = t.owner_admin_id LEFT JOIN admin_users c ON c.id = t.completed_by
    WHERE t.match_checklist_id = ? ORDER BY CASE t.phase WHEN 'before' THEN 0 WHEN 'during' THEN 1 ELSE 2 END, t.due_at, t.sort_order, t.id`).bind(id).all();
  for (const t of tasks) {
    t.completed_by_name = t.completed_by_name || t.closed_by_name || null;
    delete t.closed_by_name;
    t.overdue = !CLOSED_TASK.has(t.status) && Date.parse(t.due_at) < now;
    t.dueSoon = !CLOSED_TASK.has(t.status) && !t.overdue && Date.parse(t.due_at) - now <= DAY_MS;
    t.hasAttachment = !!t.attachment_path;
    delete t.attachment_path;
  }
  const match = e ? { id: e.id, slug: matchSlug(e), home: e.home_team, away: e.away_team, competition: e.competition, venue: e.venue, kickoff: e.event_date, matchday }
    : { id: l.match_id, home: '(match removed)', away: '', competition: '', venue: '', kickoff: l.kickoff_at, matchday };
  const ctx = await linkContext(env, db, match);
  for (const t of tasks) t.link = buildTaskLink(t, ctx, { base });
  const total = tasks.length, finished = tasks.filter(t => CLOSED_TASK.has(t.status)).length;
  return {
    id: l.id, status: l.status, note: l.note, closedAt: l.closed_at, closedBy: l.closed_by, kickoffAt: l.kickoff_at, isHome: !!l.is_home,
    match,
    tasks,
    progress: { total, finished, done: tasks.filter(t => t.status === 'done').length, pct: total ? Math.round((finished / total) * 100) : 0, overdue: tasks.filter(t => t.overdue).length },
  };
}

// ── Reminders (pure part, tested) ──

/**
 * Tasks to remind about now, for one checklist: not finished, and
 * (reminders started: kick-off minus N days) or (its own remind-from time has come)
 * or (an after-match task within the post-match reminder days).
 */
export function tasksToRemind(checklist, settings, now = Date.now()) {
  const ko = Date.parse(checklist.kickoffAt);
  return checklist.tasks.filter(t => {
    if (CLOSED_TASK.has(t.status)) return false;
    const a = now >= ko - settings.reminderDaysBefore * DAY_MS;
    const b = t.remind_from_at && now >= Date.parse(t.remind_from_at);
    const c = t.phase === 'after' && now >= ko && now <= ko + settings.postMatchReminderDays * DAY_MS;
    return a || b || c;
  });
}
/** Overdue / Due today / Due in the next 3 days (Lagos days). Tasks due later are left out of the email. */
export function digestSections(tasks, now = Date.now()) {
  const today = lagosDay(now);
  const out = { overdue: [], today: [], soon: [] };
  for (const t of tasks) {
    const due = Date.parse(t.due_at);
    if (due < now) out.overdue.push(t);
    else if (lagosDay(due) === today) out.today.push(t);
    else if (due - now <= 3 * DAY_MS) out.soon.push(t);
  }
  return out;
}
export function digestSubject(checklist, count, now = Date.now()) {
  const m = checklist.match;
  const matchDay = lagosDay(Date.parse(checklist.kickoffAt)) === lagosDay(now);
  return `${matchDay ? 'MATCH DAY: ' : ''}[${count} outstanding] Match checklist: ${m.home} vs ${m.away} — ${fmtLagos(checklist.kickoffAt, { time: false })}`;
}

/** Who gets the daily digest: all active staff (not gate/kitchen helpers), or task owners + Super Admins; plus extra addresses. */
export async function reminderRecipients(env, settings, checklists) {
  const db = env.DB;
  const { results: staff } = await db.prepare(`SELECT id, email, role FROM admin_users WHERE active = 1`).all();
  const helper = new Set(['gate_staff', 'kitchen_staff', 'kitchen']);
  let list;
  if (settings.recipientMode === 'owners_plus_super_admins') {
    const owners = new Set(checklists.flatMap(c => c.tasks.map(t => t.owner_admin_id)).filter(Boolean));
    list = staff.filter(s => owners.has(s.id) || s.role === 'super_admin');
  } else list = staff.filter(s => !helper.has(s.role));
  const emails = [...list.map(s => String(s.email || '').toLowerCase()), ...parseEmails(settings.extraRecipientEmails)].filter(e => EMAIL_RE.test(e));
  return [...new Set(emails)];
}

/** For fixture saves: keep checklists in step without ever failing the save. */
export async function syncChecklistsQuietly(env) {
  try { await syncChecklists(env); } catch (err) { console.error('[checklist] sync after fixture change', err); }
}
