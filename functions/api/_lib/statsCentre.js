// Lobi Stars Statistics Center (/staff/statistics-center/): a separate, private page where the club's
// statisticians record every match as EVENTS (goal, shot, corner, foul, card, offside, substitution, injury,
// save...). Nothing is stored as a total: every match, player and season figure is worked out from the
// events (statsCentreData.js), so correcting one event corrects every total.
//
// Like the Media Centre: Statistics Center users are NOT admin staff. Their own table (sx_users), their own
// login (Login ID + password, e.g. "Terna27"), their own cookie (ls_stats) and their own API
// (/api/stats-centre/*). The Super Admins create the accounts in the website admin (Admin › Statistics
// Center, permission stats.centre.manage). A Statistics Center session never opens the admin back end.
//
// The website Super Admins can also sign in here with their own Super Admin email, password and two-step
// code (owner's request, 27 Nov 2026): they see and can change everything, including publishing.
//
// Activity log (sx_activity): every sign-in and every change, with the old and new values. Append-only:
// database triggers refuse any UPDATE or DELETE.
//
// Built 27 Nov 2026 (owner's request; decisions: personal accounts, and a published Statistics Center match
// replaces the hand-entered Match Centre stats for that match).
import { hashPassword, verifyPassword } from './password.js';
import { ensureFanSchema, rateLimit } from './fans.js';
import { verifySuperAdmin, stillSuperAdmin, looksLikeEmail } from './superAdminLogin.js';

export const SX_COOKIE = 'ls_stats';
export const IDLE_MS = 4 * 3600e3;          // signed out after 4 hours without activity (a match plus the review)
const MAX_MS = 14 * 3600e3;                 // and after 14 hours in any case
const LOCK_AFTER = 5, LOCK_MS = 15 * 60e3;  // 5 wrong passwords: locked for 15 minutes
export const LOGIN_ID_RE = /^[A-Za-z]{2,30}[0-9]{2,4}$/;

const nowIso = () => new Date().toISOString();
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
export const newId = p => `${p}_${randomToken(9).replace(/[-_]/g, 'x')}`;
export async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export const clean = (s, max = 200) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
export const oneLine = (s, max = 200) => clean(s, max * 2).replace(/\s+/g, ' ').slice(0, max);
export const json = (d, status = 200, headers = {}) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', ...headers } });

let ready = false;
export async function ensureStatsCentreSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_users (
      id TEXT PRIMARY KEY, login_id TEXT NOT NULL, login_key TEXT NOT NULL UNIQUE, full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL, must_change_password INTEGER NOT NULL DEFAULT 1, is_active INTEGER NOT NULL DEFAULT 1,
      can_publish INTEGER NOT NULL DEFAULT 0,          -- 1 = may press "Verify and Publish" (a senior statistician)
      failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT,
      created_by TEXT, created_at TEXT NOT NULL, last_login_at TEXT, updated_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, csrf TEXT NOT NULL,
      created_at TEXT NOT NULL, last_seen TEXT NOT NULL, ended_at TEXT, ended_why TEXT, ip TEXT, user_agent TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS sx_sessions_user ON sx_sessions (user_id, ended_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
      actor_kind TEXT NOT NULL, actor_id TEXT, actor_name TEXT,   -- stats / admin / public / system
      action TEXT NOT NULL, item_type TEXT, item_id TEXT, item_title TEXT,
      old_json TEXT, new_json TEXT, details TEXT, ip TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS sx_activity_at ON sx_activity (at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS sx_activity_item ON sx_activity (item_type, item_id)`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS sx_activity_no_update BEFORE UPDATE ON sx_activity BEGIN SELECT RAISE(ABORT, 'The Statistics Center activity log cannot be changed.'); END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS sx_activity_no_delete BEFORE DELETE ON sx_activity BEGIN SELECT RAISE(ABORT, 'The Statistics Center activity log cannot be deleted.'); END`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by TEXT)`),
    // One row per match. event_id links it to the fixture (events table) when there is one; a friendly that
    // is not in the fixtures has event_id NULL. Scores are kept in step with the goal events (never typed).
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_matches (
      id TEXT PRIMARY KEY, event_id TEXT UNIQUE, season TEXT NOT NULL, competition TEXT NOT NULL, matchday TEXT,
      match_date TEXT NOT NULL, kickoff_time TEXT, venue TEXT, home_team TEXT NOT NULL, away_team TEXT NOT NULL,
      is_lobi_home INTEGER NOT NULL DEFAULT 1, referee TEXT, assistants TEXT, weather TEXT, pitch_condition TEXT,
      attendance INTEGER, formation_home TEXT, formation_away TEXT, possession_home INTEGER,   -- possession: typed in (estimate)
      published_json TEXT,                              -- what the public pages show: the last published version
      home_score INTEGER NOT NULL DEFAULT 0, away_score INTEGER NOT NULL DEFAULT 0, ht_home_score INTEGER, ht_away_score INTEGER,
      status TEXT NOT NULL DEFAULT 'draft',             -- draft | live | review | published
      clock_json TEXT,                                  -- the live clock: period and when it started/paused
      length_minutes INTEGER NOT NULL DEFAULT 90,       -- 90, or 120 with extra time (for minutes played)
      report_text TEXT, highlights_url TEXT, motm_slug TEXT,
      created_by TEXT, updated_by TEXT, verified_by TEXT, verified_at TEXT, published_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT, is_deleted INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS sx_matches_season ON sx_matches (season, status, is_deleted)`),
    // Line-ups: Lobi Stars players by their real squad slug; opponents by name and number.
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_lineups (
      id TEXT PRIMARY KEY, match_id TEXT NOT NULL, side TEXT NOT NULL,       -- home | away
      player_slug TEXT, player_name TEXT NOT NULL, shirt_number INTEGER, position TEXT,
      is_starter INTEGER NOT NULL DEFAULT 1, minutes_override INTEGER,       -- NULL = worked out from the events
      coach_rating REAL, is_motm INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS sx_lineups_match ON sx_lineups (match_id, side)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS sx_lineups_player ON sx_lineups (player_slug)`),
    // The events. id is made by the page (so an event saved twice while offline is only kept once).
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_events (
      id TEXT PRIMARY KEY, match_id TEXT NOT NULL, side TEXT NOT NULL,
      player_slug TEXT, player_name TEXT, related_slug TEXT, related_name TEXT,   -- related: the assist, or the player coming on
      event_type TEXT NOT NULL, minute INTEGER NOT NULL, stoppage_minute INTEGER, period TEXT NOT NULL,
      outcome TEXT, body_part TEXT, detail_type TEXT, pitch_zone TEXT,
      score_home_at_time INTEGER, score_away_at_time INTEGER, notes TEXT,
      created_by TEXT, created_at TEXT NOT NULL, updated_by TEXT, updated_at TEXT, is_deleted INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS sx_events_match ON sx_events (match_id, is_deleted)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS sx_events_player ON sx_events (player_slug, event_type)`),
  ]);
  // Add-on 2 (27 Nov 2026): the opponents' players, saved once per club so nobody retypes them (one row per club +
  // name + shirt number, kept unique by the code), and the coach's read-only share links.
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_opponent_players (
      id TEXT PRIMARY KEY, team_key TEXT NOT NULL, team_name TEXT NOT NULL, name TEXT NOT NULL, name_key TEXT NOT NULL, shirt_number INTEGER, usual_position TEXT,
      last_seen_match_id TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_by TEXT, created_at TEXT NOT NULL, updated_by TEXT, updated_at TEXT, is_deleted INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS sx_opp_team ON sx_opponent_players (team_key, is_deleted)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_share_links (
      id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, include_notes INTEGER NOT NULL DEFAULT 0,
      created_by TEXT, created_at TEXT NOT NULL, revoked_at TEXT, revoked_by TEXT, last_opened_at TEXT, opens INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS sx_share_a ON sx_share_links (analysis_id)`),
  ]);
  const luCols = new Set((await db.prepare(`PRAGMA table_info(sx_lineups)`).all()).results.map(r => r.name));
  if (!luCols.has('opponent_player_id')) await db.prepare(`ALTER TABLE sx_lineups ADD COLUMN opponent_player_id TEXT`).run();
  // Added later (columns of existing tables): the finishing formations (BST Analysis Form, 27 Nov 2026).
  const cols = new Set((await db.prepare(`PRAGMA table_info(sx_matches)`).all()).results.map(r => r.name));
  for (const c of ['formation_home_finish', 'formation_away_finish']) if (!cols.has(c)) await db.prepare(`ALTER TABLE sx_matches ADD COLUMN ${c} TEXT`).run();
  // Professional add-ons (27 Nov 2026): practice matches, the definitions version a match was recorded under,
  // pass end points, and read-only coach accounts.
  if (!cols.has('is_practice')) await db.prepare(`ALTER TABLE sx_matches ADD COLUMN is_practice INTEGER NOT NULL DEFAULT 0`).run();
  if (!cols.has('definitions_version')) await db.prepare(`ALTER TABLE sx_matches ADD COLUMN definitions_version INTEGER`).run();
  const evCols = new Set((await db.prepare(`PRAGMA table_info(sx_events)`).all()).results.map(r => r.name));
  for (const c of ['end_x', 'end_y']) if (!evCols.has(c)) await db.prepare(`ALTER TABLE sx_events ADD COLUMN ${c} REAL`).run();
  const uCols = new Set((await db.prepare(`PRAGMA table_info(sx_users)`).all()).results.map(r => r.name));
  if (!uCols.has('role')) await db.prepare(`ALTER TABLE sx_users ADD COLUMN role TEXT NOT NULL DEFAULT 'statistician'`).run();
  ready = true;
}

export async function sxSettings(db) {
  await ensureStatsCentreSchema(db);
  const { results } = await db.prepare(`SELECT key, value FROM sx_settings`).all();
  return Object.fromEntries(results.map(r => [r.key, r.value]));
}
export async function setSxSetting(db, key, value, by) {
  await ensureStatsCentreSchema(db);
  await db.prepare(`INSERT INTO sx_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).bind(key, String(value), nowIso(), by || null).run();
}

// ── Activity log ──
export const statsActor = user => (user.admin ? { kind: 'admin', id: user.id, name: `${user.fullName} (Super Admin)` } : { kind: 'stats', id: user.id, name: `${user.fullName} (${user.loginId})` });
export const adminActor = admin => ({ kind: 'admin', id: admin.id || admin.email, name: `${admin.name || admin.email} (admin)` });
const publicActor = name => ({ kind: 'public', id: null, name });
export async function sxLog(db, actor, action, { itemType = null, itemId = null, itemTitle = null, before = null, after = null, details = null, request = null } = {}) {
  await ensureStatsCentreSchema(db);
  const j = v => (v === null || v === undefined ? null : JSON.stringify(v).slice(0, 20000));
  await db.prepare(`INSERT INTO sx_activity (at, actor_kind, actor_id, actor_name, action, item_type, item_id, item_title, old_json, new_json, details, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(nowIso(), actor.kind, actor.id || null, actor.name || null, action, itemType, itemId ? String(itemId) : null,
    itemTitle ? oneLine(itemTitle, 200) : null, j(before), j(after), details ? oneLine(details, 500) : null,
    request?.headers.get('CF-Connecting-IP') || null).run();
}
export async function activityList(db, { item = '', limit = 300 } = {}) {
  await ensureStatsCentreSchema(db);
  const q = item ? db.prepare(`SELECT * FROM sx_activity WHERE item_id = ? ORDER BY id DESC LIMIT ?`).bind(item, limit) : db.prepare(`SELECT * FROM sx_activity ORDER BY id DESC LIMIT ?`).bind(limit);
  return (await q.all()).results;
}

// ── Accounts (made by the Super Admins in Admin › Statistics Center) ──
export function loginIdProblem(id) {
  return LOGIN_ID_RE.test(String(id || '').trim()) ? null : 'The Login ID is the person\'s name followed by 2 to 4 digits, e.g. Terna27 (letters, then digits; no spaces).';
}
/** A temporary password set by a Super Admin: it must be changed at the first sign-in, so only the basics. */
export function tempPasswordProblem(p) {
  p = String(p || '');
  if (p.length < 8 || p.length > 72) return 'The temporary password must have 8 to 72 characters.';
  if (/^\s|\s$/.test(p)) return 'The password cannot start or end with a space.';
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
  canPublish: !!u.can_publish, role: u.role || 'statistician', locked: !!(u.locked_until && Date.parse(u.locked_until) > Date.now()), lockedUntil: u.locked_until,
  createdAt: u.created_at, createdBy: u.created_by, lastLogin: u.last_login_at });
export async function listUsers(db) {
  await ensureStatsCentreSchema(db);
  return (await db.prepare(`SELECT * FROM sx_users ORDER BY is_active DESC, full_name`).all()).results.map(userView);
}
const getUser = async (db, id) => { await ensureStatsCentreSchema(db); return db.prepare(`SELECT * FROM sx_users WHERE id = ?`).bind(id).first(); };
const endSessions = (db, userId, why) => db.prepare(`UPDATE sx_sessions SET ended_at = ?, ended_why = ? WHERE user_id = ? AND ended_at IS NULL`).bind(nowIso(), why, userId).run();

export async function createUser(env, admin, request, { loginId, fullName, password, canPublish, role }) {
  const coach = role === 'coach';
  if (coach) canPublish = false;
  const db = env.DB;
  await ensureStatsCentreSchema(db);
  loginId = String(loginId || '').trim(); fullName = oneLine(fullName, 80);
  const bad = loginIdProblem(loginId) || (fullName.length < 3 ? 'Enter the person\'s full name.' : null) || tempPasswordProblem(password);
  if (bad) return { error: bad };
  if (await db.prepare(`SELECT id FROM sx_users WHERE login_key = ?`).bind(loginId.toLowerCase()).first()) return { error: 'That Login ID is already used.' };
  const id = newId('sxu'), at = nowIso();
  await db.prepare(`INSERT INTO sx_users (id, login_id, login_key, full_name, password_hash, must_change_password, can_publish, role, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`)
    .bind(id, loginId, loginId.toLowerCase(), fullName, await hashPassword(String(password)), canPublish ? 1 : 0, coach ? 'coach' : 'statistician', admin.email || admin.name, at, at).run();
  await sxLog(db, adminActor(admin), 'create_user', { itemType: 'user', itemId: id, itemTitle: `${fullName} (${loginId})`, after: { loginId, fullName, canPublish: !!canPublish, role: coach ? 'coach' : 'statistician' }, request });
  return { ok: true, id };
}

export async function updateUser(env, admin, request, id, { action, fullName, password }) {
  const db = env.DB;
  const u = await getUser(db, id);
  if (!u) return { error: 'User not found.' };
  const who = `${u.full_name} (${u.login_id})`, A = adminActor(admin), at = nowIso();
  const log = (act, extra = {}) => sxLog(db, A, act, { itemType: 'user', itemId: id, itemTitle: who, request, ...extra });
  if (action === 'reset_password') {
    const bad = tempPasswordProblem(password); if (bad) return { error: bad };
    await db.prepare(`UPDATE sx_users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?`).bind(await hashPassword(String(password)), at, id).run();
    await endSessions(db, id, 'password reset by a Super Admin');
    await log('reset_password', { details: 'Temporary password set; must be changed at next sign-in' });
  } else if (action === 'full_name') {
    fullName = oneLine(fullName, 80); if (fullName.length < 3) return { error: 'Enter the full name.' };
    await db.prepare(`UPDATE sx_users SET full_name = ?, updated_at = ? WHERE id = ?`).bind(fullName, at, id).run();
    await log('change_full_name', { before: { fullName: u.full_name }, after: { fullName } });
  } else if (action === 'disable' || action === 'enable') {
    await db.prepare(`UPDATE sx_users SET is_active = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?`).bind(action === 'enable' ? 1 : 0, at, id).run();
    if (action === 'disable') await endSessions(db, id, 'account disabled');
    await log(action === 'enable' ? 'enable_user' : 'disable_user');
  } else if (action === 'role_coach' || action === 'role_statistician') {
    const role = action === 'role_coach' ? 'coach' : 'statistician';
    await db.prepare(`UPDATE sx_users SET role = ?, can_publish = CASE WHEN ? = 'coach' THEN 0 ELSE can_publish END, updated_at = ? WHERE id = ?`).bind(role, role, at, id).run();
    await endSessions(db, id, 'account type changed');
    await log('change_role', { before: { role: u.role || 'statistician' }, after: { role } });
  } else if (action === 'publish_on' || action === 'publish_off') {
    if (action === 'publish_on' && u.role === 'coach') return { error: 'A coach account views only; it cannot publish.' };
    await db.prepare(`UPDATE sx_users SET can_publish = ?, updated_at = ? WHERE id = ?`).bind(action === 'publish_on' ? 1 : 0, at, id).run();
    await log(action === 'publish_on' ? 'allow_publish' : 'stop_publish', { before: { canPublish: !!u.can_publish }, after: { canPublish: action === 'publish_on' } });
  } else if (action === 'unlock') {
    await db.prepare(`UPDATE sx_users SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?`).bind(at, id).run();
    await log('unlock_user');
  } else if (action === 'sign_out') {
    await endSessions(db, id, 'signed out by a Super Admin');
    await log('sign_out_user');
  } else return { error: 'Unknown action.' };
  return { ok: true };
}

// ── Sign-in and sessions ──
const cookieValue = (request, name) => ((request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`)) || [])[1] || null;
// SameSite=Lax so a link from WhatsApp keeps you signed in; every change still needs the session's CSRF token.
const sessionCookie = token => `${SX_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_MS / 1000}`;
export const clearStatsCookie = () => `${SX_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

export async function signIn(env, request, { loginId, password, code }) {
  const db = env.DB;
  await ensureFanSchema(db); await ensureStatsCentreSchema(db);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await rateLimit(db, `statscentre:${ip}`, 30, 900))) return { error: 'Too many attempts from this connection. Please wait 15 minutes.', status: 429 };
  const id = String(loginId || '').trim();
  // A website Super Admin: their own email, password and two-step code.
  if (looksLikeEmail(id)) {
    const v = await verifySuperAdmin(env, { email: id, password, code }, 'stats');
    if (!v.admin) {
      if (!v.needCode) await sxLog(db, publicActor(`Super Admin sign-in (${oneLine(id, 60)})`), 'failed_login', { details: v.error, request });
      return { error: v.error, status: v.status, needCode: v.needCode };
    }
    const token = randomToken(), sid = await sha256Hex(token), csrf = randomToken(18), at = nowIso();
    await db.prepare(`INSERT INTO sx_sessions (id, user_id, csrf, created_at, last_seen, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(sid, `admin:${v.admin.id}`, csrf, at, at, ip, oneLine(request.headers.get('User-Agent') || '', 300)).run();
    await sxLog(db, { kind: 'admin', id: v.admin.id, name: `${v.admin.name} (Super Admin)` }, 'login', { details: 'Super Admin signed in with the website email', request });
    return { ok: true, cookie: sessionCookie(token) };
  }
  const u = LOGIN_ID_RE.test(id) ? await db.prepare(`SELECT * FROM sx_users WHERE login_key = ?`).bind(id.toLowerCase()).first() : null;
  if (!u) {
    // The same work for an unknown Login ID, so the answer time doesn't tell which IDs exist.
    await verifyPassword(String(password || ''), '100000:00000000000000000000000000000000:00').catch(() => false);
    await sxLog(db, publicActor(`Unknown (${oneLine(id, 40) || 'empty'})`), 'failed_login', { details: 'No such Login ID', request });
    return { error: 'The Login ID or password is not right.', status: 401 };
  }
  const who = { kind: 'stats', id: u.id, name: `${u.full_name} (${u.login_id})` };
  if (u.locked_until && Date.parse(u.locked_until) > Date.now()) {
    const mins = Math.max(1, Math.ceil((Date.parse(u.locked_until) - Date.now()) / 60000));
    await sxLog(db, who, 'failed_login', { details: 'Account locked', request });
    return { error: `Too many wrong passwords. This account is locked for ${mins} more minute${mins === 1 ? '' : 's'}.`, status: 423 };
  }
  if (!(await verifyPassword(String(password || ''), u.password_hash).catch(() => false))) {
    const n = (u.failed_attempts || 0) + 1;
    if (n >= LOCK_AFTER) {
      await db.prepare(`UPDATE sx_users SET failed_attempts = 0, locked_until = ? WHERE id = ?`).bind(new Date(Date.now() + LOCK_MS).toISOString(), u.id).run();
      await sxLog(db, who, 'account_locked', { details: `Locked for 15 minutes after ${LOCK_AFTER} wrong passwords`, request });
      return { error: 'Too many wrong passwords. This account is locked for 15 minutes.', status: 423 };
    }
    await db.prepare(`UPDATE sx_users SET failed_attempts = ? WHERE id = ?`).bind(n, u.id).run();
    await sxLog(db, who, 'failed_login', { details: `Wrong password (${n} of ${LOCK_AFTER})`, request });
    return { error: 'The Login ID or password is not right.', status: 401 };
  }
  if (!u.is_active) {
    await sxLog(db, who, 'failed_login', { details: 'Account switched off', request });
    return { error: 'This account is switched off. Ask a Super Admin.', status: 403 };
  }
  const token = randomToken(), sid = await sha256Hex(token), csrf = randomToken(18), at = nowIso();
  await db.batch([
    db.prepare(`UPDATE sx_users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?`).bind(at, u.id),
    db.prepare(`INSERT INTO sx_sessions (id, user_id, csrf, created_at, last_seen, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(sid, u.id, csrf, at, at, ip, oneLine(request.headers.get('User-Agent') || '', 300)),
  ]);
  await sxLog(db, who, 'login', { request });
  return { ok: true, cookie: sessionCookie(token) };
}

/** The Statistics Center session for this request, or null (ends idle, expired or switched-off sessions). */
export async function getStatsSession(request, env, { touch = true } = {}) {
  const token = cookieValue(request, SX_COOKIE);
  if (!token || !/^[\w-]{20,80}$/.test(token)) return null;
  const db = env.DB;
  await ensureStatsCentreSchema(db);
  const s = await db.prepare(`SELECT s.*, u.login_id, u.full_name, u.is_active, u.must_change_password, u.can_publish, u.role FROM sx_sessions s LEFT JOIN sx_users u ON u.id = s.user_id WHERE s.id = ? AND s.ended_at IS NULL`)
    .bind(await sha256Hex(token)).first();
  if (!s) return null;
  const now = Date.now();
  const end = why => db.prepare(`UPDATE sx_sessions SET ended_at = ?, ended_why = ? WHERE id = ?`).bind(nowIso(), why, s.id).run();
  // A website Super Admin (must still be one): everything, including publishing.
  if (String(s.user_id).startsWith('admin:')) {
    const a = await stillSuperAdmin(env, s.user_id.slice(6));
    if (!a) { await end('no longer a Super Admin'); return null; }
    if (now - Date.parse(s.last_seen) > IDLE_MS) { await end('no activity for 4 hours'); return null; }
    if (now - Date.parse(s.created_at) > MAX_MS) { await end('14 hours'); return null; }
    if (touch && now - Date.parse(s.last_seen) > 30e3) await db.prepare(`UPDATE sx_sessions SET last_seen = ? WHERE id = ?`).bind(nowIso(), s.id).run();
    return { id: s.id, csrf: s.csrf, user: { id: s.user_id, loginId: a.email, fullName: a.name, mustChange: false, canPublish: true, admin: true } };
  }
  if (!s.login_id) return null;
  if (!s.is_active) { await end('account switched off'); return null; }
  if (now - Date.parse(s.last_seen) > IDLE_MS) { await end('no activity for 4 hours'); return null; }
  if (now - Date.parse(s.created_at) > MAX_MS) { await end('14 hours'); return null; }
  if (touch && now - Date.parse(s.last_seen) > 30e3) await db.prepare(`UPDATE sx_sessions SET last_seen = ? WHERE id = ?`).bind(nowIso(), s.id).run();
  return { id: s.id, csrf: s.csrf, user: { id: s.user_id, loginId: s.login_id, fullName: s.full_name, mustChange: !!s.must_change_password, canPublish: !!s.can_publish && s.role !== 'coach', role: s.role || 'statistician', readOnly: s.role === 'coach' } };
}
export async function signOut(env, request, session) {
  await env.DB.prepare(`UPDATE sx_sessions SET ended_at = ?, ended_why = 'signed out' WHERE id = ? AND ended_at IS NULL`).bind(nowIso(), session.id).run();
  await sxLog(env.DB, statsActor(session.user), 'logout', { request });
}
export async function changePassword(env, request, session, { current, password }) {
  const db = env.DB;
  if (session.user.admin) return { error: 'Super Admins change their password in the website admin (My Account).' };
  const u = await getUser(db, session.user.id);
  if (!u) return { error: 'Please sign in again.' };
  if (!(await verifyPassword(String(current || ''), u.password_hash).catch(() => false))) return { error: 'Your current (temporary) password is not right.' };
  const bad = passwordProblem(password, u.login_id);
  if (bad) return { error: bad };
  if (await verifyPassword(String(password), u.password_hash).catch(() => false)) return { error: 'Choose a new password, not the temporary one.' };
  const at = nowIso();
  await db.batch([
    db.prepare(`UPDATE sx_users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?`).bind(await hashPassword(String(password)), at, u.id),
    db.prepare(`UPDATE sx_sessions SET ended_at = ?, ended_why = 'password changed' WHERE user_id = ? AND ended_at IS NULL AND id <> ?`).bind(at, u.id, session.id),
  ]);
  await sxLog(db, statsActor(session.user), 'change_password', { request });
  return { ok: true };
}
/** Checks that a change comes from this website and carries the session's CSRF token. */
export function csrfProblem(request, session) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return 'This request came from another website and was refused.';
  if (request.headers.get('X-CSRF-Token') !== session.csrf) return 'The page is out of date. Please reload it.';
  return null;
}
