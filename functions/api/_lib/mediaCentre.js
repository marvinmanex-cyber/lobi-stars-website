// The Media Centre (/media-centre): a separate, private page for the club's
// media staff. They write content there; the Super Admins approve it in the
// main admin (Media Centre › Approval Queue); approved content then appears on
// the public website in the places that already show it.
//
// Media Centre users are NOT admin staff: their own table, their own login
// (Login ID + password, e.g. "Iorbee68"), their own cookie (ls_media) and their
// own API (/api/media-centre/*). A Media Centre session never opens the admin
// back end (both admin middlewares refuse it).
//
// Activity log (mc_activity): every Media Centre action and every Media
// Centre-related admin action. Append-only: database triggers refuse any
// UPDATE or DELETE, and no code changes or removes rows.
//
// Content workflow (mc_items, one table for every kind of content):
//   draft -> submitted -> published (or scheduled -> published)
//                      -> returned (with the Super Admin's comment) -> submitted again
//                      -> rejected
//   published -> unpublished (never deleted)
// A published item that is corrected keeps its live version (live_json) until
// the correction is approved: `correction` is then draft / submitted / returned.
// Every submission, approval and return saves a revision (mc_revisions).
import { hashPassword, verifyPassword } from './password.js';
import { ensureFanSchema, rateLimit } from './fans.js';
import { verifySuperAdmin, stillSuperAdmin } from './superAdminLogin.js';

export const MC_COOKIE = 'ls_media';
export const IDLE_MS = 30 * 60e3;          // signed out after 30 minutes without activity
const MAX_MS = 12 * 3600e3;                // and after 12 hours in any case
const LOCK_AFTER = 5, LOCK_MS = 15 * 60e3; // 5 wrong passwords: locked for 15 minutes
export const LOGIN_ID_RE = /^[A-Za-z]{2,30}[0-9]{2,4}$/;
export const STATUSES = ['draft', 'submitted', 'returned', 'scheduled', 'published', 'unpublished', 'rejected'];
export const KIND_LABELS = { news: 'News story', newsletter: 'Lobi Stars Weekly Newsletter', press: 'Press release', album: 'Photo album', lineup: 'Line-up', live: 'Live update' };

// The preset news categories (Super Admins can add, rename or hide categories).
// tab: the /news page tab the story is listed under (Team News, Features or Tickets).
export const PRESET_CATEGORIES = [
  ['Match Preview', 'Team News'], ['Match Report', 'Team News'], ['Team News & Line-ups', 'Team News'], ['Post-Match Reaction', 'Team News'],
  ['First Team News', 'Team News'], ['Injury Updates', 'Team News'], ['Transfer News', 'Team News'], ['Contract News', 'Team News'],
  ['Player Interviews', 'Features'], ["Coach's Corner", 'Features'], ['Club Announcements', 'Team News'], ['Official Statements', 'Team News'],
  ['Ticketing News', 'Tickets'], ['Fixtures Update', 'Team News'], ['Partner & Sponsor News', 'Features'], ['Community', 'Features'], ['Fans', 'Features'],
];
export const NEWS_TABS = ['Team News', 'Features', 'Tickets'];
export const DEFAULT_TAB = 'Team News';

export const SETTING_DEFAULTS = {
  accreditation_close_hours: '6',    // applications close this many hours before kick-off (media officers can reopen a match)
  accreditation_max: '20',           // accredited journalists per match
  newsletter_deadline: '2|18:00',    // Tuesday 6 PM (day of week 0 = Sunday | Lagos time)
  newsletter_publish: '3|08:00',     // Wednesday 8 AM
  media_team_email: 'media@lobistarsfc.com', // Monday reminders (Media Centre users have no email address)
  press_contact: 'Media Department, Lobi Stars FC · media@lobistarsfc.com',
  whatsapp_channel_url: '',          // the club's WhatsApp channel: Matchday Desk › Live updates opens it
};

const nowIso = () => new Date().toISOString();
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
export const newId = p => `${p}_${randomToken(9).replace(/[-_]/g, 'x')}`;
export async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export const clean = (s, max = 200) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
export const oneLine = (s, max = 200) => clean(s, max * 2).replace(/\s+/g, ' ').slice(0, max);
export const parseJson = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };
export const json = (d, status = 200, headers = {}) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', ...headers } });

// ── Schema ──
let ready = false;
export async function ensureMediaSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS mc_users (
      id TEXT PRIMARY KEY,
      login_id TEXT NOT NULL,
      login_key TEXT NOT NULL UNIQUE,          -- login_id in lower case (Login IDs are not case-sensitive)
      full_name TEXT NOT NULL,                 -- printed on accreditation cards: "Signed: <full_name>"
      password_hash TEXT NOT NULL,             -- PBKDF2-SHA256 (password.js)
      must_change_password INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      created_by TEXT, created_at TEXT NOT NULL, last_login_at TEXT, updated_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS mc_sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, csrf TEXT NOT NULL,
      created_at TEXT NOT NULL, last_seen TEXT NOT NULL, ended_at TEXT, ended_why TEXT, ip TEXT, user_agent TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS mc_sessions_user ON mc_sessions (user_id, ended_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS mc_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      actor_kind TEXT NOT NULL,                -- media / admin / public / system
      actor_id TEXT, actor_name TEXT,
      action TEXT NOT NULL,                    -- login, logout, failed_login, create, edit, submit, approve, return, reject, unpublish, upload, ...
      section TEXT,                            -- account / news / newsletter / accreditation / press / matchday / library / interviews / presskit / calendar / users
      item_type TEXT, item_id TEXT, item_title TEXT, details TEXT, ip TEXT, user_agent TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS mc_activity_at ON mc_activity (at)`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS mc_activity_no_update BEFORE UPDATE ON mc_activity BEGIN SELECT RAISE(ABORT, 'The Media Centre activity log cannot be changed.'); END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS mc_activity_no_delete BEFORE DELETE ON mc_activity BEGIN SELECT RAISE(ABORT, 'The Media Centre activity log cannot be deleted.'); END`),
    db.prepare(`CREATE TABLE IF NOT EXISTS mc_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS mc_items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,                      -- news / newsletter / press / album / presskit / lineup
      status TEXT NOT NULL DEFAULT 'draft',
      correction TEXT,                         -- published item being corrected: draft / submitted / returned
      title TEXT, slug TEXT,
      data_json TEXT NOT NULL,                 -- the working copy
      live_json TEXT,                          -- the published version
      ref TEXT,                                -- e.g. the match (event id) for line-ups and newsletters' week
      scheduled_at TEXT, published_at TEXT, unpublished_at TEXT,
      created_by TEXT, created_by_name TEXT, created_at TEXT NOT NULL,
      updated_by_name TEXT, updated_at TEXT NOT NULL,
      submitted_at TEXT, submitted_by_name TEXT,
      decided_at TEXT, decided_by TEXT, comment TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      publish_error TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS mc_items_kind ON mc_items (kind, status, updated_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS mc_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL, version INTEGER NOT NULL,
      event TEXT NOT NULL,                     -- submitted / approved / returned / rejected / edited_by_admin / unpublished
      data_json TEXT NOT NULL, by_name TEXT, at TEXT NOT NULL, comment TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS mc_revisions_item ON mc_revisions (item_id, id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS mc_categories (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, tab TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0, preset INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS mc_files (
      id TEXT PRIMARY KEY, r2_key TEXT NOT NULL, kind TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL,
      name TEXT, width INTEGER, height INTEGER, is_public INTEGER NOT NULL DEFAULT 0,
      uploaded_by TEXT, uploaded_by_name TEXT, created_at TEXT NOT NULL)`),
  ]);
  const have = await db.prepare(`SELECT COUNT(*) AS n FROM mc_categories`).first();
  if (!have?.n) {
    await db.batch(PRESET_CATEGORIES.map(([name, tab], i) =>
      db.prepare(`INSERT OR IGNORE INTO mc_categories (id, name, tab, sort, preset) VALUES (?, ?, ?, ?, 1)`).bind(`cat_${i + 1}`, name, tab, i + 1)));
  }
  // The old tabs (First Team, Club, Media Watch) were removed on 1 Nov 2026: move categories still pointing at them.
  // Accreditation closes 6 hours before kick-off since 1 Nov 2026 (was 48): move a saved 48 once.
  if (!(await db.prepare(`SELECT 1 FROM mc_settings WHERE key = 'accr_close_6'`).first())) {
    await db.batch([db.prepare(`UPDATE mc_settings SET value = '6' WHERE key = 'accreditation_close_hours' AND value = '48'`),
      db.prepare(`INSERT OR IGNORE INTO mc_settings (key, value, updated_at) VALUES ('accr_close_6', '1', ?)`).bind(nowIso())]);
  }
  const presetTab = Object.fromEntries(PRESET_CATEGORIES);
  const { results: old } = await db.prepare(`SELECT id, name FROM mc_categories WHERE tab NOT IN ('Team News', 'Features', 'Tickets')`).all();
  if (old.length) await db.batch(old.map(c => db.prepare(`UPDATE mc_categories SET tab = ? WHERE id = ?`).bind(presetTab[c.name] || DEFAULT_TAB, c.id)));
  ready = true;
}

// ── Settings ──
export async function mcSettings(db) {
  await ensureMediaSchema(db);
  const rows = (await db.prepare(`SELECT key, value FROM mc_settings`).all()).results;
  return { ...SETTING_DEFAULTS, ...Object.fromEntries(rows.map(r => [r.key, r.value])) };
}
export async function setMcSetting(db, key, value, by) {
  await db.prepare(`INSERT INTO mc_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).bind(key, String(value), nowIso(), by || null).run();
}

// ── Activity log ──
export const mediaActor = user => ({ kind: 'media', id: user.id, name: `${user.fullName} (${user.loginId})` });
export const adminActor = admin => ({ kind: 'admin', id: admin.id || admin.email, name: `${admin.name || admin.email} (admin)` });
export const publicActor = (name = 'Public form') => ({ kind: 'public', id: null, name });
export const SYSTEM = { kind: 'system', id: null, name: 'Website (automatic)' };
export async function mcLog(db, actor, action, { section = null, itemType = null, itemId = null, itemTitle = null, details = null, request = null } = {}) {
  try {
    await ensureMediaSchema(db);
    await db.prepare(`INSERT INTO mc_activity (at, actor_kind, actor_id, actor_name, action, section, item_type, item_id, item_title, details, ip, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(nowIso(), actor.kind, actor.id || null, actor.name || null, action, section, itemType, itemId ? String(itemId) : null,
      itemTitle ? oneLine(itemTitle, 200) : null, details ? clean(details, 1000) : null,
      request?.headers.get('CF-Connecting-IP') || null, request ? oneLine(request.headers.get('User-Agent') || '', 300) : null).run();
  } catch (e) { console.error('[media centre] log', e); }
}
export const LOG_SECTIONS = ['account', 'users', 'news', 'newsletter', 'accreditation', 'press', 'matchday', 'library', 'interviews', 'presskit', 'calendar', 'settings'];

/** Activity log with filters (admin page and CSV). */
export async function activityList(db, { user = '', from = '', to = '', section = '', action = '', limit = 300, before = null } = {}) {
  await ensureMediaSchema(db);
  const w = [], b = [];
  if (user) { w.push('actor_id = ?'); b.push(user); }
  if (from) { w.push('at >= ?'); b.push(`${from}T00:00:00`); }
  if (to) { w.push('at <= ?'); b.push(`${to}T23:59:59.999Z`); }
  if (section) { w.push('section = ?'); b.push(section); }
  if (action) { w.push('action = ?'); b.push(action); }
  if (before) { w.push('id < ?'); b.push(Number(before)); }
  return (await db.prepare(`SELECT * FROM mc_activity ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`).bind(...b, Math.min(5000, limit)).all()).results;
}

// ── Users (created and managed by the Super Admins) ──
export function loginIdProblem(id) {
  const s = String(id || '').trim();
  if (!LOGIN_ID_RE.test(s)) return 'The Login ID is the person\'s name followed by 2 to 4 digits, e.g. Iorbee68 (letters, then digits; no spaces).';
  return null;
}
export function passwordProblem(p, loginId = '') {
  p = String(p || '');
  if (p.length < 8) return 'The password must have at least 8 characters.';
  if (p.length > 72) return 'The password can have at most 72 characters.';
  if (/^\s|\s$/.test(p)) return 'The password cannot start or end with a space.';
  if (loginId && p.toLowerCase().includes(String(loginId).toLowerCase())) return 'The password cannot contain the Login ID.';
  if (/^(.)\1+$/.test(p) || /^(?:12345678|password|qwerty|lobistars|11111111)/i.test(p)) return 'That password is too easy to guess.';
  return null;
}
const userView = u => u && ({ id: u.id, loginId: u.login_id, fullName: u.full_name, mustChange: !!u.must_change_password, active: !!u.is_active,
  locked: !!(u.locked_until && Date.parse(u.locked_until) > Date.now()), lockedUntil: u.locked_until, failed: u.failed_attempts,
  createdAt: u.created_at, createdBy: u.created_by, lastLogin: u.last_login_at });
export async function listUsers(db) {
  await ensureMediaSchema(db);
  return (await db.prepare(`SELECT * FROM mc_users ORDER BY is_active DESC, full_name`).all()).results.map(userView);
}
export async function getUser(db, id) { await ensureMediaSchema(db); return db.prepare(`SELECT * FROM mc_users WHERE id = ?`).bind(id).first(); }
async function endSessions(db, userId, why) {
  await db.prepare(`UPDATE mc_sessions SET ended_at = ?, ended_why = ? WHERE user_id = ? AND ended_at IS NULL`).bind(nowIso(), why, userId).run();
}
export async function createUser(env, admin, request, { loginId, fullName, password }) {
  const db = env.DB;
  await ensureMediaSchema(db);
  loginId = String(loginId || '').trim(); fullName = oneLine(fullName, 80);
  const bad = loginIdProblem(loginId) || (fullName.length < 3 ? 'Enter the person\'s full name (it is printed on accreditation cards).' : null) || passwordProblem(password, loginId);
  if (bad) return { error: bad };
  if (await db.prepare(`SELECT id FROM mc_users WHERE login_key = ?`).bind(loginId.toLowerCase()).first()) return { error: 'That Login ID is already used.' };
  const id = newId('mcu'), at = nowIso();
  await db.prepare(`INSERT INTO mc_users (id, login_id, login_key, full_name, password_hash, must_change_password, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`)
    .bind(id, loginId, loginId.toLowerCase(), fullName, await hashPassword(String(password)), admin.email || admin.name, at, at).run();
  await mcLog(db, adminActor(admin), 'create_user', { section: 'users', itemType: 'user', itemId: id, itemTitle: `${fullName} (${loginId})`, request });
  return { ok: true, id };
}
export async function updateUser(env, admin, request, id, { action, loginId, fullName, password }) {
  const db = env.DB;
  const u = await getUser(db, id);
  if (!u) return { error: 'User not found.' };
  const who = `${u.full_name} (${u.login_id})`, A = adminActor(admin), at = nowIso();
  if (action === 'reset_password') {
    const bad = passwordProblem(password, u.login_id); if (bad) return { error: bad };
    await db.prepare(`UPDATE mc_users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?`).bind(await hashPassword(String(password)), at, id).run();
    await endSessions(db, id, 'password reset by a Super Admin');
    await mcLog(db, A, 'reset_password', { section: 'users', itemType: 'user', itemId: id, itemTitle: who, details: 'Temporary password set; must be changed at next sign-in', request });
  } else if (action === 'login_id') {
    loginId = String(loginId || '').trim();
    const bad = loginIdProblem(loginId); if (bad) return { error: bad };
    const clash = await db.prepare(`SELECT id FROM mc_users WHERE login_key = ? AND id <> ?`).bind(loginId.toLowerCase(), id).first();
    if (clash) return { error: 'That Login ID is already used.' };
    await db.prepare(`UPDATE mc_users SET login_id = ?, login_key = ?, updated_at = ? WHERE id = ?`).bind(loginId, loginId.toLowerCase(), at, id).run();
    await mcLog(db, A, 'change_login_id', { section: 'users', itemType: 'user', itemId: id, itemTitle: `${u.full_name} (${loginId})`, details: `Login ID ${u.login_id} -> ${loginId}`, request });
  } else if (action === 'full_name') {
    fullName = oneLine(fullName, 80); if (fullName.length < 3) return { error: 'Enter the full name.' };
    await db.prepare(`UPDATE mc_users SET full_name = ?, updated_at = ? WHERE id = ?`).bind(fullName, at, id).run();
    await mcLog(db, A, 'change_full_name', { section: 'users', itemType: 'user', itemId: id, itemTitle: `${fullName} (${u.login_id})`, details: `${u.full_name} -> ${fullName}`, request });
  } else if (action === 'disable' || action === 'enable') {
    await db.prepare(`UPDATE mc_users SET is_active = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?`).bind(action === 'enable' ? 1 : 0, at, id).run();
    if (action === 'disable') await endSessions(db, id, 'account disabled');
    await mcLog(db, A, action === 'enable' ? 'enable_user' : 'disable_user', { section: 'users', itemType: 'user', itemId: id, itemTitle: who, request });
  } else if (action === 'unlock') {
    await db.prepare(`UPDATE mc_users SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?`).bind(at, id).run();
    await mcLog(db, A, 'unlock_user', { section: 'users', itemType: 'user', itemId: id, itemTitle: who, request });
  } else if (action === 'sign_out') {
    await endSessions(db, id, 'signed out by a Super Admin');
    await mcLog(db, A, 'sign_out_user', { section: 'users', itemType: 'user', itemId: id, itemTitle: who, request });
  } else return { error: 'Unknown action.' };
  return { ok: true };
}

// ── The media approver (approval password) ──
// A designated media staff member signs in to the Media Centre with the approval
// password only (no Login ID) and sees only the Approval Queue. Anyone with the
// password can approve; no name is recorded or shown: "Media approver". The
// Super Admins set the password (Admin › Media Centre › Users & settings);
// changing it signs out everyone using the old one.
export const APPROVER_ID = '__approver__';
export const APPROVER_USER = { id: APPROVER_ID, loginId: 'approver', fullName: 'Media approver', mustChange: false, approver: true };
export const APPROVER_ACTOR = { kind: 'media', id: APPROVER_ID, name: 'Media approver' };
export async function setApproverPassword(db, admin, request, password) {
  const bad = passwordProblem(password, 'approver');
  if (bad) return { error: bad };
  await setMcSetting(db, 'approver_password_hash', await hashPassword(String(password)), admin.email || admin.name);
  await endSessions(db, APPROVER_ID, 'approval password changed');
  await mcLog(db, adminActor(admin), 'approver_password', { section: 'users', details: 'Approval password set or changed (approver sessions ended)', request });
  return { ok: true };
}
export async function approverSignIn(env, request, password) {
  const db = env.DB;
  await ensureFanSchema(db); await ensureMediaSchema(db);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await rateLimit(db, `mediacentre:${ip}`, 30, 900))) return { error: 'Too many attempts from this connection. Please wait 15 minutes.', status: 429 };
  const key = `mc-approver-fail:${ip}`, win = Math.floor(Date.now() / 1000), start = win - (win % 900);
  const row = await db.prepare(`SELECT window_start, count FROM rate_limits WHERE key = ?`).bind(key).first();
  if (row && row.window_start === start && row.count >= LOCK_AFTER) return { error: 'Too many wrong passwords. Wait 15 minutes and try again.', status: 423 };
  const hash = (await mcSettings(db)).approver_password_hash;
  const ok = await verifyPassword(String(password || ''), hash || '100000:00000000000000000000000000000000:00').catch(() => false);
  if (!hash || !ok) {
    await rateLimit(db, key, 1e6, 900);
    await mcLog(db, publicActor('Approver sign-in'), 'failed_login', { section: 'account', details: hash ? 'Wrong approval password' : 'No approval password set yet', request });
    return { error: hash ? 'That approval password is not right.' : 'Approver sign-in is not set up yet. Ask a Super Admin.', status: 401 };
  }
  const token = randomToken(), sid = await sha256Hex(token), csrf = randomToken(18), at = nowIso();
  await db.prepare(`INSERT INTO mc_sessions (id, user_id, csrf, created_at, last_seen, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(sid, APPROVER_ID, csrf, at, at, ip, oneLine(request.headers.get('User-Agent') || '', 300)).run();
  await mcLog(db, APPROVER_ACTOR, 'login', { section: 'account', details: 'Signed in with the approval password', request });
  return { ok: true, cookie: sessionCookie(token), session: { csrf, user: APPROVER_USER } };
}

// ── Website Super Admins: email, password and two-step code (a Media Centre session only) ──
export async function adminMediaSignIn(env, request, { email, password, code }) {
  const db = env.DB;
  await ensureFanSchema(db); await ensureMediaSchema(db);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await rateLimit(db, `mediacentre:${ip}`, 30, 900))) return { error: 'Too many attempts from this connection. Please wait 15 minutes.', status: 429 };
  const v = await verifySuperAdmin(env, { email, password, code }, 'media');
  if (!v.admin) {
    if (!v.needCode) await mcLog(db, publicActor(`Email sign-in (${oneLine(email, 60)})`), 'failed_login', { section: 'account', details: v.error, request });
    return { error: v.error, status: v.status, needCode: v.needCode };
  }
  const token = randomToken(), sid = await sha256Hex(token), csrf = randomToken(18), at = nowIso();
  await db.prepare(`INSERT INTO mc_sessions (id, user_id, csrf, created_at, last_seen, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(sid, `admin:${v.admin.id}`, csrf, at, at, ip, oneLine(request.headers.get('User-Agent') || '', 300)).run();
  const user = { id: `admin:${v.admin.id}`, loginId: v.admin.email, fullName: v.admin.name, mustChange: false, admin: true };
  await mcLog(db, mediaActor(user), 'login', { section: 'account', details: 'Super Admin signed in with the website email', request });
  return { ok: true, cookie: sessionCookie(token), session: { csrf, user } };
}

// ── Sign-in and sessions ──
const cookieValue = (request, name) => ((request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`)) || [])[1] || null;
const sessionCookie = token => `${MC_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${MAX_MS / 1000}`;
export const clearMediaCookie = () => `${MC_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
export const hasMediaCookie = request => !!cookieValue(request, MC_COOKIE);

export async function signIn(env, request, { loginId, password }) {
  const db = env.DB;
  await ensureFanSchema(db); await ensureMediaSchema(db);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await rateLimit(db, `mediacentre:${ip}`, 30, 900))) return { error: 'Too many attempts from this connection. Please wait 15 minutes.', status: 429 };
  const id = String(loginId || '').trim();
  if (!LOGIN_ID_RE.test(id)) {
    await mcLog(db, publicActor(`Unknown (${oneLine(id, 40) || 'empty'})`), 'failed_login', { section: 'account', details: 'Login ID in the wrong format', request });
    return { error: 'The Login ID or password is not right.', status: 401 };
  }
  const u = await db.prepare(`SELECT * FROM mc_users WHERE login_key = ?`).bind(id.toLowerCase()).first();
  // The same work for an unknown Login ID, so the answer time doesn't tell which IDs exist.
  if (!u) {
    await verifyPassword(String(password || ''), '100000:00000000000000000000000000000000:00').catch(() => false);
    await mcLog(db, publicActor(`Unknown (${id})`), 'failed_login', { section: 'account', details: 'No such Login ID', request });
    return { error: 'The Login ID or password is not right.', status: 401 };
  }
  const who = { kind: 'media', id: u.id, name: `${u.full_name} (${u.login_id})` };
  if (u.locked_until && Date.parse(u.locked_until) > Date.now()) {
    const mins = Math.max(1, Math.ceil((Date.parse(u.locked_until) - Date.now()) / 60000));
    await mcLog(db, who, 'failed_login', { section: 'account', details: 'Account locked', request });
    return { error: `Too many wrong passwords. This account is locked for ${mins} more minute${mins === 1 ? '' : 's'}.`, status: 423 };
  }
  const ok = await verifyPassword(String(password || ''), u.password_hash).catch(() => false);
  if (!ok) {
    const n = (u.failed_attempts || 0) + 1;
    if (n >= LOCK_AFTER) {
      await db.prepare(`UPDATE mc_users SET failed_attempts = 0, locked_until = ? WHERE id = ?`).bind(new Date(Date.now() + LOCK_MS).toISOString(), u.id).run();
      await mcLog(db, who, 'failed_login', { section: 'account', details: `Wrong password (${n}); account locked for 15 minutes`, request });
      await mcLog(db, who, 'account_locked', { section: 'account', details: `Locked for 15 minutes after ${LOCK_AFTER} wrong passwords`, request });
      return { error: 'Too many wrong passwords. This account is locked for 15 minutes.', status: 423 };
    }
    await db.prepare(`UPDATE mc_users SET failed_attempts = ? WHERE id = ?`).bind(n, u.id).run();
    await mcLog(db, who, 'failed_login', { section: 'account', details: `Wrong password (${n} of ${LOCK_AFTER})`, request });
    return { error: 'The Login ID or password is not right.', status: 401 };
  }
  if (!u.is_active) {
    await mcLog(db, who, 'failed_login', { section: 'account', details: 'Account disabled', request });
    return { error: 'This account is switched off. Ask a Super Admin.', status: 403 };
  }
  const token = randomToken(), sid = await sha256Hex(token), csrf = randomToken(18), at = nowIso();
  await db.batch([
    db.prepare(`UPDATE mc_users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?`).bind(at, u.id),
    db.prepare(`INSERT INTO mc_sessions (id, user_id, csrf, created_at, last_seen, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(sid, u.id, csrf, at, at, ip, oneLine(request.headers.get('User-Agent') || '', 300)),
  ]);
  await mcLog(db, who, 'login', { section: 'account', request });
  return { ok: true, cookie: sessionCookie(token), session: { csrf, user: userView({ ...u, last_login_at: at }) } };
}

/** The Media Centre session for this request, or null (ends idle, expired or disabled sessions). */
export async function getMediaSession(request, env, { touch = true } = {}) {
  const token = cookieValue(request, MC_COOKIE);
  if (!token || !/^[\w-]{20,80}$/.test(token)) return null;
  const db = env.DB;
  await ensureMediaSchema(db);
  const s = await db.prepare(`SELECT s.*, u.login_id, u.full_name, u.is_active, u.must_change_password FROM mc_sessions s LEFT JOIN mc_users u ON u.id = s.user_id WHERE s.id = ? AND s.ended_at IS NULL`)
    .bind(await sha256Hex(token)).first();
  if (!s) return null;
  // A website Super Admin's Media Centre session (they must still be a Super Admin).
  if (String(s.user_id).startsWith('admin:')) {
    const a = await stillSuperAdmin(env, s.user_id.slice(6));
    const endIt = why => db.prepare(`UPDATE mc_sessions SET ended_at = ?, ended_why = ? WHERE id = ?`).bind(nowIso(), why, s.id).run();
    if (!a) { await endIt('no longer a Super Admin'); return null; }
    if (Date.now() - Date.parse(s.last_seen) > IDLE_MS) { await endIt('no activity for 30 minutes'); return null; }
    if (Date.now() - Date.parse(s.created_at) > MAX_MS) { await endIt('12 hours'); return null; }
    if (touch && Date.now() - Date.parse(s.last_seen) > 30e3) await db.prepare(`UPDATE mc_sessions SET last_seen = ? WHERE id = ?`).bind(nowIso(), s.id).run();
    return { id: s.id, csrf: s.csrf, lastSeen: s.last_seen, user: { id: s.user_id, loginId: a.email, fullName: a.name, mustChange: false, admin: true } };
  }
  const approver = s.user_id === APPROVER_ID;
  if (approver) { s.is_active = (await mcSettings(db)).approver_password_hash ? 1 : 0; s.full_name = APPROVER_USER.fullName; s.login_id = APPROVER_USER.loginId; s.must_change_password = 0; }
  else if (!s.login_id) return null;
  const now = Date.now();
  const end = async why => {
    await db.prepare(`UPDATE mc_sessions SET ended_at = ?, ended_why = ? WHERE id = ?`).bind(nowIso(), why, s.id).run();
    if (why.startsWith('no activity')) await mcLog(db, { kind: 'media', id: s.user_id, name: `${s.full_name} (${s.login_id})` }, 'logout', { section: 'account', details: 'Signed out automatically after 30 minutes without activity' });
  };
  if (!s.is_active) { await end('account disabled'); return null; }
  if (now - Date.parse(s.last_seen) > IDLE_MS) { await end('no activity for 30 minutes'); return null; }
  if (now - Date.parse(s.created_at) > MAX_MS) { await end('12 hours'); return null; }
  if (touch && now - Date.parse(s.last_seen) > 30e3) await db.prepare(`UPDATE mc_sessions SET last_seen = ? WHERE id = ?`).bind(nowIso(), s.id).run();
  if (approver) return { id: s.id, csrf: s.csrf, lastSeen: s.last_seen, user: { ...APPROVER_USER } };
  return { id: s.id, csrf: s.csrf, lastSeen: s.last_seen, user: { id: s.user_id, loginId: s.login_id, fullName: s.full_name, mustChange: !!s.must_change_password } };
}
export async function signOut(env, request, session, why = 'signed out') {
  await env.DB.prepare(`UPDATE mc_sessions SET ended_at = ?, ended_why = ? WHERE id = ? AND ended_at IS NULL`).bind(nowIso(), why, session.id).run();
  await mcLog(env.DB, mediaActor(session.user), 'logout', { section: 'account', request });
}
export async function changePassword(env, request, session, { current, password }) {
  const db = env.DB;
  const u = await getUser(db, session.user.id);
  if (!u) return { error: 'Please sign in again.' };
  if (!(await verifyPassword(String(current || ''), u.password_hash).catch(() => false))) return { error: 'Your current (temporary) password is not right.' };
  const bad = passwordProblem(password, u.login_id);
  if (bad) return { error: bad };
  if (await verifyPassword(String(password), u.password_hash).catch(() => false)) return { error: 'Choose a new password, not the temporary one.' };
  const at = nowIso();
  await db.batch([
    db.prepare(`UPDATE mc_users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?`).bind(await hashPassword(String(password)), at, u.id),
    db.prepare(`UPDATE mc_sessions SET ended_at = ?, ended_why = 'password changed' WHERE user_id = ? AND ended_at IS NULL AND id <> ?`).bind(at, u.id, session.id),
  ]);
  await mcLog(db, mediaActor(session.user), 'change_password', { section: 'account', request });
  return { ok: true };
}

/** Checks that a write comes from this website and carries the session's CSRF token. */
export function csrfProblem(request, session) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return 'This request came from another website and was refused.';
  if (request.headers.get('X-CSRF-Token') !== session.csrf) return 'The page is out of date. Please reload it.';
  return null;
}

// ── Categories ──
export async function categories(db, { all = false } = {}) {
  await ensureMediaSchema(db);
  return (await db.prepare(`SELECT * FROM mc_categories ${all ? '' : 'WHERE hidden = 0'} ORDER BY sort, name`).all()).results
    .map(c => ({ id: c.id, name: c.name, tab: c.tab, hidden: !!c.hidden, preset: !!c.preset, sort: c.sort }));
}

// ── Content items: the shared workflow ──
export function itemView(r, { full = true } = {}) {
  if (!r) return null;
  const v = { id: r.id, kind: r.kind, kindLabel: KIND_LABELS[r.kind] || r.kind, status: r.status, correction: r.correction || null, title: r.title || '(untitled)', slug: r.slug,
    ref: r.ref, scheduledAt: r.scheduled_at, publishedAt: r.published_at, createdBy: r.created_by, createdByName: r.created_by_name, createdAt: r.created_at,
    updatedAt: r.updated_at, updatedByName: r.updated_by_name, submittedAt: r.submitted_at, submittedByName: r.submitted_by_name, decidedAt: r.decided_at, decidedBy: r.decided_by,
    comment: r.comment, version: r.version, publishError: r.publish_error };
  if (full) { v.data = parseJson(r.data_json, {}); v.live = parseJson(r.live_json, null); }
  return v;
}
export async function getItem(db, id) { await ensureMediaSchema(db); return db.prepare(`SELECT * FROM mc_items WHERE id = ?`).bind(id).first(); }
/** What a media user may do with an item. */
export function editable(r) {
  if (['draft', 'returned'].includes(r.status)) return true;
  if (['published', 'scheduled'].includes(r.status)) return r.correction !== 'submitted';
  return false;
}
export async function createItem(db, user, kind, { title, data, ref = null }) {
  await ensureMediaSchema(db);
  const id = newId(kind.slice(0, 3)), at = nowIso();
  await db.prepare(`INSERT INTO mc_items (id, kind, status, title, data_json, ref, created_by, created_by_name, created_at, updated_by_name, updated_at) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, kind, oneLine(title, 200) || null, JSON.stringify(data || {}), ref, user.id, user.fullName, at, user.fullName, at).run();
  return id;
}
/** Saves the working copy (autosave). A published item keeps its live version: the change becomes a correction. */
export async function saveItem(db, user, r, { title, data, ref }) {
  if (!editable(r)) return { error: r.status === 'submitted' || r.correction === 'submitted' ? 'This is waiting for approval and cannot be changed now.' : 'This can no longer be changed.' };
  const live = ['published', 'scheduled'].includes(r.status);
  const at = nowIso();
  await db.prepare(`UPDATE mc_items SET title = ?, data_json = ?, ref = COALESCE(?, ref), updated_by_name = ?, updated_at = ?, correction = ? WHERE id = ?`)
    .bind(oneLine(title, 200) || null, JSON.stringify(data || {}), ref ?? null, user.fullName, at, live ? (r.correction === 'returned' ? 'returned' : 'draft') : r.correction, r.id).run();
  return { ok: true, at, correction: live };
}
export async function addRevision(db, r, event, data, byName, comment = null) {
  await db.prepare(`INSERT INTO mc_revisions (item_id, version, event, data_json, by_name, at, comment) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(r.id, r.version || 0, event, typeof data === 'string' ? data : JSON.stringify(data), byName, nowIso(), comment).run();
}
export async function submitItem(db, user, r, { scheduledAt = null, setSchedule = false } = {}) {
  if (!editable(r)) return { error: 'This is already waiting for approval.' };
  const at = nowIso(), live = ['published', 'scheduled'].includes(r.status);
  const version = (r.version || 0) + 1;
  await db.prepare(`UPDATE mc_items SET ${live ? "correction = 'submitted'" : "status = 'submitted'"}, submitted_at = ?, submitted_by_name = ?, version = ?, comment = NULL, scheduled_at = ${setSchedule ? '?' : 'COALESCE(?, scheduled_at)'} WHERE id = ?`)
    .bind(at, user.fullName, version, scheduledAt, r.id).run();
  await addRevision(db, { ...r, version }, live ? 'correction_submitted' : 'submitted', r.data_json, user.fullName);
  return { ok: true };
}
export async function revisions(db, id) {
  return (await db.prepare(`SELECT id, version, event, by_name, at, comment, data_json FROM mc_revisions WHERE item_id = ? ORDER BY id DESC LIMIT 60`).bind(id).all()).results
    .map(x => ({ id: x.id, version: x.version, event: x.event, by: x.by_name, at: x.at, comment: x.comment, data: parseJson(x.data_json, {}) }));
}
/** Items waiting for a Super Admin (Approval Queue). */
export async function queue(db) {
  await ensureMediaSchema(db);
  return (await db.prepare(`SELECT * FROM mc_items WHERE (status = 'submitted' OR correction = 'submitted') AND kind <> 'presskit' ORDER BY COALESCE(submitted_at, updated_at) DESC LIMIT 200`).all()).results.map(r => itemView(r));
}
export async function queueCount(db) {
  await ensureMediaSchema(db);
  return (await db.prepare(`SELECT COUNT(*) AS n FROM mc_items WHERE (status = 'submitted' OR correction = 'submitted') AND kind <> 'presskit'`).first())?.n || 0;
}

/** The Media Centre home: my drafts, waiting, returned, recently published, deadlines. */
export async function dashboard(db, user) {
  await ensureMediaSchema(db);
  const mine = (await db.prepare(`SELECT * FROM mc_items WHERE created_by = ? AND status IN ('draft', 'returned', 'submitted') OR (created_by = ? AND correction IS NOT NULL) ORDER BY updated_at DESC LIMIT 80`).bind(user.id, user.id).all()).results.map(r => itemView(r, { full: false }));
  const published = (await db.prepare(`SELECT * FROM mc_items WHERE status IN ('published', 'scheduled') ORDER BY COALESCE(published_at, scheduled_at) DESC LIMIT 12`).all()).results.map(r => itemView(r, { full: false }));
  // Draft stories suggested automatically (squad milestones) for anyone in the team to write.
  const suggestions = (await db.prepare(`SELECT * FROM mc_items WHERE created_by = 'system' AND status = 'draft' ORDER BY created_at DESC LIMIT 12`).all()).results.map(r => itemView(r, { full: false }));
  return {
    drafts: mine.filter(i => i.status === 'draft' || i.correction === 'draft'),
    waiting: mine.filter(i => i.status === 'submitted' || i.correction === 'submitted'),
    returned: mine.filter(i => i.status === 'returned' || i.correction === 'returned'),
    published, suggestions,
  };
}
