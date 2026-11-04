// Gate Control (/gate-control): the matchday ticket stewards' own area, separate
// from the website admin back end (like MatchDay Kitchen and the Media Centre).
//
// Ticket Stewards are NOT admin staff: their own table (gc_staff), their own
// Staff IDs (e.g. LSG-001) and passwords, their own cookie (ls_gate) and their
// own API (/api/gate-control/*). A Gate Control session never opens /admin.
// Website Super Admins may also sign in here with their website email and
// password; that creates a Gate Control session only.
//
// Each person picks the gate they are working at (Main Gate, VIP Gate, …) and
// every scan is recorded with their name, Staff ID and gate. Any number of
// phones can scan at once: a ticket is checked in by one atomic update, so the
// same ticket can never be admitted twice.
//
// Everything is recorded in gc_activity (append-only: database triggers refuse
// changes and deletions). Ticket checks themselves are in gateCheck.js.
import { hashPassword, verifyPassword } from './password.js';
import { ensureFanSchema, rateLimit } from './fans.js';
import { isFullSuperAdmin } from './superAdmins.js';

export const GC_COOKIE = 'ls_gate';
// A sign-in stays open for 24 hours on that phone or computer, with no sign-out for being
// idle, so a steward is never asked to sign in again with a queue at the gate. Switching
// someone off or changing their password still signs them out at once.
const MAX_MS = 24 * 3600e3;
const IDLE_MS = MAX_MS;
const LOCK_AFTER = 5, LOCK_MS = 15 * 60e3;     // 5 wrong passwords: locked for 15 minutes
export const STAFF_ID_RE = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
export const ROLES = { steward: 'Ticket Steward', supervisor: 'Gate Supervisor' };
export const DEFAULT_GATES = ['Main Gate', 'VIP Gate', 'Grand Stand Gate', 'Popular Stand Gate'];

const nowIso = () => new Date().toISOString();
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
export const newId = p => `${p}_${randomToken(9).replace(/[-_]/g, 'x')}`;
async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export const clean = (s, max = 200) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
export const oneLine = (s, max = 200) => clean(s, max * 2).replace(/\s+/g, ' ').slice(0, max);
export const json = (d, status = 200, headers = {}) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', ...headers } });

// ── Schema ──
let ready = false;
export async function ensureGateSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS gc_staff (
      id TEXT PRIMARY KEY, staff_id TEXT NOT NULL UNIQUE, full_name TEXT NOT NULL,
      role TEXT NOT NULL,                       -- steward / supervisor
      password_hash TEXT NOT NULL,              -- PBKDF2-SHA256 (password.js); passwords are never stored
      is_active INTEGER NOT NULL DEFAULT 1, failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT,
      created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT, last_login_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS gc_sessions (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, user_id TEXT NOT NULL, csrf TEXT NOT NULL, gate TEXT,
      created_at TEXT NOT NULL, last_seen TEXT NOT NULL, ended_at TEXT, ended_why TEXT, ip TEXT, user_agent TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS gc_sessions_user ON gc_sessions (user_id, ended_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS gc_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
      actor_kind TEXT NOT NULL,                 -- staff / admin / public / system
      actor_id TEXT, actor_name TEXT, actor_code TEXT, gate TEXT,
      action TEXT NOT NULL, kind TEXT,          -- sign_in / sign_out / gate / scan / staff / settings / open
      details TEXT, ip TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS gc_activity_at ON gc_activity (at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS gc_activity_actor ON gc_activity (actor_id, at)`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS gc_activity_no_update BEFORE UPDATE ON gc_activity BEGIN SELECT RAISE(ABORT, 'The Gate Control activity log cannot be changed.'); END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS gc_activity_no_delete BEFORE DELETE ON gc_activity BEGIN SELECT RAISE(ABORT, 'The Gate Control activity log cannot be deleted.'); END`),
    // Every scan or typed ticket number, admitted or refused (the live view and "already used at…").
    db.prepare(`CREATE TABLE IF NOT EXISTS gc_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
      ticket_id TEXT, raw TEXT, event_id TEXT, tier TEXT,
      result TEXT NOT NULL,                     -- admitted / readmitted / used / fake / not_lobi / wrong_match / void / unpaid / lookup / error
      how TEXT,                                 -- camera / typed
      gate TEXT, staff_user_id TEXT, staff_name TEXT, staff_code TEXT, note TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS gc_scans_at ON gc_scans (at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS gc_scans_ticket ON gc_scans (ticket_id, at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS gc_scans_event ON gc_scans (event_id, result)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS gc_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by TEXT)`),
  ]);
  ready = true;
}

// ── Settings (the gates) ──
export async function gateSettings(db) {
  await ensureGateSchema(db);
  const row = await db.prepare(`SELECT value FROM gc_settings WHERE key = 'gates'`).first();
  let gates = [];
  try { gates = JSON.parse(row?.value || '[]'); } catch { gates = []; }
  gates = (Array.isArray(gates) ? gates : []).map(g => oneLine(g, 40)).filter(Boolean);
  if (!gates.length) gates = DEFAULT_GATES;
  // Which stands each gate is for (wrong-gate guidance). A gate with none listed takes every stand.
  const st = await db.prepare(`SELECT value FROM gc_settings WHERE key = 'gate_stands'`).first();
  let stands = {};
  try { stands = JSON.parse(st?.value || '{}') || {}; } catch { stands = {}; }
  stands = Object.fromEntries(gates.map(g => [g, (Array.isArray(stands[g]) ? stands[g] : []).filter(t => STAND_KEYS.includes(t))]));
  return { gates, stands };
}
export const STAND_KEYS = ['VIP', 'Premium', 'Regular'];
export async function saveGateStands(db, who, map) {
  const { gates } = await gateSettings(db);
  const clean = Object.fromEntries(gates.map(g => [g, (Array.isArray(map?.[g]) ? map[g] : []).filter(t => STAND_KEYS.includes(t))]));
  // Every stand must still have at least one gate.
  const uncovered = STAND_KEYS.filter(t => !gates.some(g => !clean[g].length || clean[g].includes(t)));
  if (uncovered.length) return { error: `No gate is left for ${uncovered.map(t => ({ VIP: 'VIP Sitting', Premium: 'Grand Stand', Regular: 'Popular Stand' })[t]).join(', ')}. Tick it for at least one gate.` };
  await db.prepare(`INSERT INTO gc_settings (key, value, updated_at, updated_by) VALUES ('gate_stands', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .bind(JSON.stringify(clean), nowIso(), who).run();
  return { ok: true, stands: clean };
}
export async function saveGates(db, who, list) {
  const gates = [...new Set((Array.isArray(list) ? list : String(list || '').split(/\n|,/)).map(g => oneLine(g, 40)).filter(Boolean))].slice(0, 20);
  if (!gates.length) return { error: 'Add at least one gate.' };
  await db.prepare(`INSERT INTO gc_settings (key, value, updated_at, updated_by) VALUES ('gates', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .bind(JSON.stringify(gates), nowIso(), who).run();
  return { ok: true, gates };
}

// ── Who may do what ──
export function permissions(user) {
  const sa = user.kind === 'admin', sup = sa || user.role === 'supervisor';
  return { scan: true, lookup: true, readmit: sup, supervise: sup, activityAll: sup, staff: sa, settings: sa };
}

// ── Activity log ──
export async function gcLog(db, user, action, { kind = null, details = null, request = null, gate = null } = {}) {
  try {
    await ensureGateSchema(db);
    await db.prepare(`INSERT INTO gc_activity (at, actor_kind, actor_id, actor_name, actor_code, gate, action, kind, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(nowIso(), user?.kind || 'system', user?.id || null, user?.name || null, user?.code || null, gate || user?.gate || null, oneLine(action, 300), kind,
        details ? clean(details, 1000) : null, request?.headers.get('CF-Connecting-IP') || null).run();
  } catch (e) { console.error('[gate control] activity', e); }
}
export async function activityPage(db, { userId = '', day = '', page = 1, limit = 50, all = false } = {}) {
  await ensureGateSchema(db);
  const w = [], b = [];
  if (userId) { w.push('actor_id = ?'); b.push(userId); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) { w.push('at >= ? AND at < ?'); b.push(new Date(Date.parse(`${day}T00:00:00Z`) - 3600e3).toISOString(), new Date(Date.parse(`${day}T00:00:00Z`) + 23 * 3600e3).toISOString()); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM gc_activity ${where}`).bind(...b).first()).n;
  const p = Math.max(1, Number(page) || 1);
  const rows = all
    ? (await db.prepare(`SELECT * FROM gc_activity ${where} ORDER BY id DESC LIMIT 20000`).bind(...b).all()).results
    : (await db.prepare(`SELECT * FROM gc_activity ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).bind(...b, limit, (p - 1) * limit).all()).results;
  return { total, page: p, pages: Math.max(1, Math.ceil(total / limit)), rows };
}

// ── Staff accounts (managed by the Super Admins) ──
export function staffIdProblem(id) {
  if (!id) return 'Enter a Staff ID, e.g. LSG-001.';
  if (id.length > 20 || !STAFF_ID_RE.test(id)) return 'The Staff ID can only have letters, numbers and dashes, e.g. LSG-001.';
  return null;
}
const COMMON = /^(password|passw0rd|12345678|123456789|1234567890|qwerty|qwertyuiop|iloveyou|letmein|welcome|admin|football|lobistars|matchday|ticket|tickets|gate|abc12345|11111111|00000000)\d*$/i;
export function passwordProblem(p, staffId = '', name = '') {
  p = String(p || '');
  if (p.length < 8) return 'The password must have at least 8 characters.';
  if (p.length > 72) return 'The password can have at most 72 characters.';
  if (/^\d+$/.test(p)) return "The password can't be only numbers.";
  if (COMMON.test(p) || /^(.)\1+$/.test(p)) return 'That password is too common. Choose another.';
  const low = p.toLowerCase().replace(/-/g, '');
  const similar = [staffId, ...String(name).split(/\s+/)].map(x => String(x || '').toLowerCase().replace(/-/g, '')).filter(x => x.length >= 3);
  if (similar.some(x => low.includes(x))) return "The password is too like the person's Staff ID or name.";
  return null;
}
const staffView = s => ({ id: s.id, staffId: s.staff_id, name: s.full_name, role: s.role, roleLabel: ROLES[s.role] || s.role, active: !!s.is_active,
  locked: !!(s.locked_until && Date.parse(s.locked_until) > Date.now()), lastLogin: s.last_login_at, createdAt: s.created_at });
export async function listStaff(db) {
  await ensureGateSchema(db);
  return (await db.prepare(`SELECT * FROM gc_staff ORDER BY is_active DESC, full_name`).all()).results.map(staffView);
}
async function endSessions(db, userId, why) {
  await db.prepare(`UPDATE gc_sessions SET ended_at = ?, ended_why = ? WHERE user_id = ? AND ended_at IS NULL`).bind(nowIso(), why, userId).run();
}
export async function createStaff(env, by, request, v) {
  const db = env.DB;
  await ensureGateSchema(db);
  const staffId = String(v.staffId || '').trim().toUpperCase(), name = oneLine(v.name, 80), role = String(v.role || '');
  const bad = staffIdProblem(staffId) || (name.length < 2 ? "Enter the person's full name." : null) || (!ROLES[role] ? 'Choose a role.' : null) || passwordProblem(v.password, staffId, name);
  if (bad) return { error: bad };
  if (await db.prepare(`SELECT id FROM gc_staff WHERE staff_id = ?`).bind(staffId).first()) return { error: 'That Staff ID is already used. Choose another.' };
  const id = newId('gcs'), at = nowIso();
  await db.prepare(`INSERT INTO gc_staff (id, staff_id, full_name, role, password_hash, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, staffId, name, role, await hashPassword(String(v.password)), by.code || by.name, at, at).run();
  await gcLog(db, by, `Created staff account ${name} (${staffId}), ${ROLES[role]}`, { kind: 'staff', request });
  return { ok: true, id };
}
export async function updateStaff(env, by, request, id, v) {
  const db = env.DB;
  await ensureGateSchema(db);
  const s = await db.prepare(`SELECT * FROM gc_staff WHERE id = ?`).bind(String(id)).first();
  if (!s) return { error: 'That staff account no longer exists.' };
  const name = v.name !== undefined ? oneLine(v.name, 80) : s.full_name;
  const role = v.role !== undefined ? String(v.role) : s.role;
  const active = v.active !== undefined ? (v.active ? 1 : 0) : s.is_active;
  if (name.length < 2) return { error: "Enter the person's full name." };
  if (!ROLES[role]) return { error: 'Choose a role.' };
  const pw = String(v.password || '');
  if (pw) { const bad = passwordProblem(pw, s.staff_id, name); if (bad) return { error: bad }; }
  const changes = [];
  if (name !== s.full_name) changes.push(`name ${s.full_name} → ${name}`);
  if (role !== s.role) changes.push(`role ${ROLES[s.role] || s.role} → ${ROLES[role]}`);
  if (active !== s.is_active) changes.push(active ? 'can sign in again' : 'switched off');
  if (pw) changes.push('password reset');
  if (!changes.length) return { ok: true, unchanged: true };
  await db.prepare(`UPDATE gc_staff SET full_name = ?, role = ?, is_active = ?, ${pw ? 'password_hash = ?, failed_attempts = 0, locked_until = NULL, ' : ''}updated_at = ? WHERE id = ?`)
    .bind(...[name, role, active, ...(pw ? [await hashPassword(pw)] : []), nowIso(), s.id]).run();
  if (pw || !active) await endSessions(db, s.id, pw ? 'password changed' : 'account switched off');
  await gcLog(db, by, `Changed staff account ${name} (${s.staff_id}): ${changes.join(', ')}`, { kind: 'staff', request });
  return { ok: true };
}

// ── Sign-in and sessions ──
const cookieValue = (request, name) => ((request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`)) || [])[1] || null;
const sessionCookie = token => `${GC_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${MAX_MS / 1000}`;
export const clearGateCookie = () => `${GC_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
const FAIL = 'The Staff ID / email or password is not right.';
const DUMMY_HASH = '100000:00000000000000000000000000000000:00';
const staffActor = s => ({ kind: 'staff', id: s.id, name: s.full_name, code: s.staff_id });
const adminActor = u => ({ kind: 'admin', id: u.id, name: u.name || u.email, code: u.email });

async function startSession(db, request, kind, userId) {
  const token = randomToken(), sid = await sha256Hex(token), csrf = randomToken(18), at = nowIso();
  await db.prepare(`INSERT INTO gc_sessions (id, kind, user_id, csrf, created_at, last_seen, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(sid, kind, userId, csrf, at, at, request.headers.get('CF-Connecting-IP') || null, oneLine(request.headers.get('User-Agent') || '', 300)).run();
  return { cookie: sessionCookie(token) };
}

export async function signIn(env, request, { login, password }) {
  const db = env.DB;
  await ensureFanSchema(db); await ensureGateSchema(db);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await rateLimit(db, `gc-login:${ip}`, 40, 900))) return { error: 'Too many attempts from this connection. Please wait 15 minutes.', status: 429 };
  const raw = String(login || '').trim().slice(0, 120);
  const pw = String(password || '');

  // A website Super Admin, with their website email (email and password; a Gate Control session only).
  if (raw.includes('@')) {
    const email = raw.toLowerCase();
    const key = `gc-email-fail:${email}`;
    const row = await db.prepare(`SELECT window_start, count FROM rate_limits WHERE key = ?`).bind(key).first();
    const win = Math.floor(Date.now() / 1000), start = win - (win % 900);
    if (row && row.window_start === start && row.count >= LOCK_AFTER) {
      await gcLog(db, { kind: 'public', name: email, code: email }, 'Sign-in refused: locked after too many wrong passwords', { kind: 'sign_in', request });
      return { error: 'Too many wrong passwords. Wait 15 minutes and try again.', status: 423 };
    }
    const u = await db.prepare(`SELECT * FROM admin_users WHERE email = ?`).bind(email).first().catch(() => null);
    const ok = await verifyPassword(pw, u?.password_hash || DUMMY_HASH).catch(() => false);
    const allowed = ok && u && u.active && !u.disabled_at && isFullSuperAdmin(env, u);
    if (!allowed) {
      await rateLimit(db, key, 1e6, 900);
      await gcLog(db, { kind: 'public', name: email, code: email }, ok && u ? 'Sign-in refused: only website Super Admins can sign in with an email' : 'Wrong email or password', { kind: 'sign_in', request });
      return { error: ok && u ? 'Only website Super Admins can sign in with an email. Ticket stewards use their Staff ID.' : FAIL, status: 401 };
    }
    const s = await startSession(db, request, 'admin', u.id);
    await gcLog(db, adminActor(u), 'Signed in', { kind: 'sign_in', request });
    return { ok: true, cookie: s.cookie };
  }

  // Ticket stewards, with their Staff ID.
  const staffId = raw.toUpperCase();
  const s = STAFF_ID_RE.test(staffId) ? await db.prepare(`SELECT * FROM gc_staff WHERE staff_id = ?`).bind(staffId).first() : null;
  if (!s) {
    await verifyPassword(pw, DUMMY_HASH).catch(() => false);
    await gcLog(db, { kind: 'public', name: `Unknown (${oneLine(raw, 40) || 'empty'})`, code: oneLine(raw, 40) }, 'Sign-in refused: no such Staff ID', { kind: 'sign_in', request });
    return { error: FAIL, status: 401 };
  }
  const who = staffActor(s);
  if (s.locked_until && Date.parse(s.locked_until) > Date.now()) {
    const mins = Math.max(1, Math.ceil((Date.parse(s.locked_until) - Date.now()) / 60000));
    await verifyPassword(pw, DUMMY_HASH).catch(() => false);
    await gcLog(db, who, 'Sign-in refused: account locked', { kind: 'sign_in', request });
    return { error: `Too many wrong passwords. This Staff ID is locked for ${mins} more minute${mins === 1 ? '' : 's'}.`, status: 423 };
  }
  const ok = await verifyPassword(pw, s.password_hash).catch(() => false);
  if (!ok) {
    const n = (s.failed_attempts || 0) + 1;
    if (n >= LOCK_AFTER) {
      await db.prepare(`UPDATE gc_staff SET failed_attempts = 0, locked_until = ? WHERE id = ?`).bind(new Date(Date.now() + LOCK_MS).toISOString(), s.id).run();
      await gcLog(db, who, `Wrong password (${n}); Staff ID locked for 15 minutes`, { kind: 'sign_in', request });
      return { error: 'Too many wrong passwords. This Staff ID is locked for 15 minutes.', status: 423 };
    }
    await db.prepare(`UPDATE gc_staff SET failed_attempts = ? WHERE id = ?`).bind(n, s.id).run();
    await gcLog(db, who, `Wrong password (${n} of ${LOCK_AFTER})`, { kind: 'sign_in', request });
    return { error: FAIL, status: 401 };
  }
  if (!s.is_active) {
    await gcLog(db, who, 'Sign-in refused: account switched off', { kind: 'sign_in', request });
    return { error: 'This account is switched off. Ask a Gate Supervisor or a Super Admin.', status: 403 };
  }
  await db.prepare(`UPDATE gc_staff SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?`).bind(nowIso(), s.id).run();
  const sess = await startSession(db, request, 'staff', s.id);
  await gcLog(db, who, 'Signed in', { kind: 'sign_in', request });
  return { ok: true, cookie: sess.cookie };
}

/** The Gate Control session for this request, or null (ends idle, expired and switched-off sessions). */
export async function getGateSession(request, env, { touch = true } = {}) {
  const token = cookieValue(request, GC_COOKIE);
  if (!token || !/^[\w-]{20,80}$/.test(token)) return null;
  const db = env.DB;
  await ensureGateSchema(db);
  const s = await db.prepare(`SELECT * FROM gc_sessions WHERE id = ? AND ended_at IS NULL`).bind(await sha256Hex(token)).first();
  if (!s) return null;
  let user = null;
  if (s.kind === 'staff') {
    const st = await db.prepare(`SELECT * FROM gc_staff WHERE id = ?`).bind(s.user_id).first();
    if (st?.is_active) user = { ...staffActor(st), role: st.role, roleLabel: ROLES[st.role] || st.role, firstName: st.full_name.split(' ')[0] };
  } else {
    const u = await db.prepare(`SELECT * FROM admin_users WHERE id = ?`).bind(s.user_id).first().catch(() => null);
    if (u && u.active && !u.disabled_at && isFullSuperAdmin(env, u)) user = { ...adminActor(u), role: 'super_admin', roleLabel: 'Super Admin', firstName: String(u.name || u.email).split(/[ @]/)[0] };
  }
  const end = async (why, log) => {
    await db.prepare(`UPDATE gc_sessions SET ended_at = ?, ended_why = ? WHERE id = ?`).bind(nowIso(), why, s.id).run();
    if (log && user) await gcLog(db, { ...user, gate: s.gate }, log, { kind: 'sign_out' });
  };
  const now = Date.now();
  if (!user) { await end('account switched off or no longer allowed'); return null; }
  if (now - Date.parse(s.last_seen) > IDLE_MS) { await end('no activity', 'Signed out automatically (no activity)'); return null; }
  if (now - Date.parse(s.created_at) > MAX_MS) { await end('24 hours', 'Signed out automatically (24 hours)'); return null; }
  if (touch && now - Date.parse(s.last_seen) > 20e3) await db.prepare(`UPDATE gc_sessions SET last_seen = ? WHERE id = ?`).bind(nowIso(), s.id).run();
  user.gate = s.gate || null;
  return { id: s.id, csrf: s.csrf, user };
}
export async function setGate(db, session, gate, request) {
  const { gates } = await gateSettings(db);
  const g = oneLine(gate, 40);
  if (!gates.includes(g)) return { error: 'Choose one of the gates on the list.' };
  await db.prepare(`UPDATE gc_sessions SET gate = ? WHERE id = ?`).bind(g, session.id).run();
  const from = session.user.gate;
  session.user.gate = g;
  await gcLog(db, session.user, from ? `Moved from ${from} to ${g}` : `Started at ${g}`, { kind: 'gate', request });
  return { ok: true, gate: g };
}
export async function signOut(db, session, request) {
  await db.prepare(`UPDATE gc_sessions SET ended_at = ?, ended_why = 'signed out' WHERE id = ? AND ended_at IS NULL`).bind(nowIso(), session.id).run();
  await gcLog(db, session.user, 'Signed out', { kind: 'sign_out', request });
}
/** Changes must come from the Gate Control page: same website and the session's token. */
export function csrfProblem(request, session) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return 'This change must be made from Gate Control.';
  if (request.headers.get('X-CSRF-Token') !== session.csrf) return 'Please reload the page and try again.';
  return null;
}
/** Who is working right now, and at which gate (sessions seen in the last 10 minutes). */
export async function onDuty(db) {
  await ensureGateSchema(db);
  const since = new Date(Date.now() - 10 * 60e3).toISOString();
  const rows = (await db.prepare(`SELECT s.kind, s.gate, s.last_seen, st.full_name, st.staff_id, st.role, a.name AS admin_name, a.email
    FROM gc_sessions s LEFT JOIN gc_staff st ON s.kind = 'staff' AND st.id = s.user_id LEFT JOIN admin_users a ON s.kind = 'admin' AND a.id = s.user_id
    WHERE s.ended_at IS NULL AND s.last_seen > ? ORDER BY s.last_seen DESC`).bind(since).all()).results;
  const seen = new Set();
  return rows.filter(r => { const k = r.staff_id || r.email; if (seen.has(k)) return false; seen.add(k); return true; }).map(r => ({ name: r.full_name || r.admin_name || r.email || 'Unknown', code: r.staff_id || r.email || '', role: r.kind === 'admin' ? 'Super Admin' : ROLES[r.role] || r.role, gate: r.gate || 'No gate chosen', lastSeen: r.last_seen }));
}
