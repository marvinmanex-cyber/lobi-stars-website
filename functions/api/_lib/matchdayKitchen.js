// MatchDay Kitchen (/matchday-kitchen): the kitchen staff's own area, separate
// from the website admin back end (like the Media Centre and the IT Centre).
//
// Kitchen staff are NOT admin staff: their own table (mk_staff), their own
// Staff IDs (e.g. LSK-001) and a personal 8-number login code (no email or
// password; since 5 Nov 2026), their own cookie (ls_mdk) and their
// own API (/api/matchday-kitchen/*). A kitchen session never opens /admin (the
// admin middlewares only accept the admin session). Website Super Admins may
// also sign in here with their website email and password (and two-step code);
// that creates a kitchen session only and never signs them in or out of /admin.
//
// Everything is recorded in mk_activity under the person's name and Staff ID
// (append-only: database triggers refuse changes and deletions). Recording
// never stops the kitchen: a failed write is logged and the work carries on.
// No approval step: what staff do takes effect at once. Orders and the menu
// are only read and changed through kitchenData.js.
import { verifyPassword } from './password.js';
import { ensureFanSchema, rateLimit } from './fans.js';
import { isFullSuperAdmin } from './superAdmins.js';
import { verifyTotp } from './totp.js';
import { looksLikeBackupCode, useBackupCode } from './adminSecurity.js';
import { DEFAULT_VENUE } from './foodOrders.js';

export const MK_COOKIE = 'ls_mdk';
export const IDLE_MS = 22 * 60e3;              // the page asks "Still there?" after 20 minutes; the server ends the session after 22
const MAX_MS = 14 * 3600e3;                    // and after 14 hours in any case (a long match day)
const LOCK_AFTER = 5;                          // Super Admin email sign-in: 5 wrong passwords, wait 15 minutes
const CODE_FAILS = 10;                         // login codes: 10 wrong codes from one connection, wait 15 minutes
export const STAFF_ID_RE = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
export const ROLES = { cook: 'Cook / kitchen hand', pass: 'Pass / order handler', delivery: 'Delivery / runner', supervisor: 'Kitchen supervisor' };
export const SETTING_DEFAULTS = { telegram_url: '', cancel_roles: 'pass,supervisor', price_roles: 'supervisor', late_minutes: '5' };

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
export async function ensureKitchenSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS mk_staff (
      id TEXT PRIMARY KEY, staff_id TEXT NOT NULL UNIQUE, full_name TEXT NOT NULL,
      role TEXT NOT NULL,                       -- cook / pass / supervisor
      password_hash TEXT NOT NULL,              -- not used since 5 Nov 2026 (staff sign in with a login code)
      is_active INTEGER NOT NULL DEFAULT 1, failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT,
      created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT, last_login_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS mk_sessions (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, user_id TEXT NOT NULL, csrf TEXT NOT NULL,
      created_at TEXT NOT NULL, last_seen TEXT NOT NULL, ended_at TEXT, ended_why TEXT, ip TEXT, user_agent TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS mk_sessions_user ON mk_sessions (user_id, ended_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS mk_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
      actor_kind TEXT NOT NULL,                 -- staff / admin / public / system
      actor_id TEXT, actor_name TEXT, actor_code TEXT,  -- name and Staff ID (or Super Admin email), kept even if the account is removed
      action TEXT NOT NULL,                     -- in plain words, e.g. "Order FD-…: Preparing to Ready"
      kind TEXT,                                -- sign_in / sign_out / open / order / menu / price / shift / note / staff / settings
      details TEXT, ip TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS mk_activity_at ON mk_activity (at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS mk_activity_actor ON mk_activity (actor_id, at)`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS mk_activity_no_update BEFORE UPDATE ON mk_activity BEGIN SELECT RAISE(ABORT, 'The MatchDay Kitchen activity log cannot be changed.'); END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS mk_activity_no_delete BEFORE DELETE ON mk_activity BEGIN SELECT RAISE(ABORT, 'The MatchDay Kitchen activity log cannot be deleted.'); END`),
    db.prepare(`CREATE TABLE IF NOT EXISTS mk_shifts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, code TEXT, role TEXT,
      started_at TEXT NOT NULL, ended_at TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS mk_shifts_user ON mk_shifts (user_id, started_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS mk_notes (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, author_name TEXT NOT NULL, author_code TEXT,
      text TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, deleted_at TEXT, deleted_by TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS mk_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by TEXT)`),
  ]);
  // The personal login code, stored only as a hash (shown once, when it is made).
  try { await db.prepare(`ALTER TABLE mk_staff ADD COLUMN login_code_hash TEXT`).run(); } catch { /* already there */ }
  await db.prepare(`CREATE INDEX IF NOT EXISTS mk_staff_code ON mk_staff (login_code_hash)`).run();
  // The order workflow (6 Nov 2026): each person and shift belongs to a venue; the log keeps before and after.
  for (const [t, col] of [['mk_staff', 'venue_id'], ['mk_shifts', 'venue_id'], ['mk_activity', 'before_json'], ['mk_activity', 'after_json']]) {
    try { await db.prepare(`ALTER TABLE ${t} ADD COLUMN ${col} TEXT`).run(); } catch { /* already there */ }
  }
  ready = true;
}

// ── Settings ──
export async function kitchenSettings(db) {
  await ensureKitchenSchema(db);
  const rows = (await db.prepare(`SELECT key, value FROM mk_settings`).all()).results;
  const s = { ...SETTING_DEFAULTS, ...Object.fromEntries(rows.map(r => [r.key, r.value])) };
  return { telegramUrl: s.telegram_url || '', cancelRoles: s.cancel_roles.split(',').filter(r => ROLES[r]), priceRoles: s.price_roles.split(',').filter(r => ROLES[r]), lateMinutes: Math.max(1, Math.min(120, Number(s.late_minutes) || 5)) };
}
export async function saveSettings(db, who, v) {
  const at = nowIso();
  const put = (k, val) => db.prepare(`INSERT INTO mk_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).bind(k, val, at, who);
  const url = clean(v.telegramUrl, 300);
  if (url && !/^https:\/\/(t\.me|telegram\.me)\/[\w+/-]+$/i.test(url)) return { error: 'The Telegram link must look like https://t.me/yourchannel' };
  const roles = list => (Array.isArray(list) ? list : []).filter(r => ROLES[r]).join(',');
  const late = Math.max(1, Math.min(120, Math.round(Number(v.lateMinutes) || 5)));
  await db.batch([put('telegram_url', url), put('cancel_roles', roles(v.cancelRoles)), put('late_minutes', String(late))]);
  return { ok: true };
}

// ── Who is signed in, and what they may do ──
export function permissions(user, settings) {
  const sa = user.kind === 'admin';
  const manager = sa || user.role === 'supervisor';
  return {
    move: true, soldOut: true,
    cancel: manager,                                // cancelling and rejecting: supervisors and Super Admins only
    reports: manager,                               // sales figures and reports
    money: manager || user.role === 'pass',         // totals, payment details and the fan's masked number
    flag: !sa && user.role !== 'delivery',          // tell a supervisor an ingredient is missing
    alertLevel: sa,                                 // only Super Admins can change what they hear: nobody else can mute
    price: sa || user.role === 'supervisor',        // prices, and adding and deleting dishes: supervisors and Super Admins only
    menu: sa || user.role === 'supervisor',
    // Confirming or rejecting an order, recording a WhatsApp payment and opening its evidence: supervisors and Super Admins.
    // Everyone else sees the orders and hears the alarm.
    confirm: sa || user.role === 'supervisor', payment: sa || user.role === 'supervisor', paymentOverride: sa || user.role === 'supervisor',
    notes: sa || user.role === 'supervisor',        // pin / delete anyone's handover notes
    // The kitchen's back end: supervisors see everyone's activity, manage cooks and pass staff, and change the settings.
    activityAll: sa || user.role === 'supervisor', staff: sa || user.role === 'supervisor', superAdmin: sa,
    ordering: sa || user.role === 'supervisor',     // open and close food ordering for fans
  };
}

// ── Activity log ──
export async function mkLog(db, user, action, { kind = null, details = null, request = null, before = null, after = null } = {}) {
  try {
    await ensureKitchenSchema(db);
    await db.prepare(`INSERT INTO mk_activity (at, actor_kind, actor_id, actor_name, actor_code, action, kind, details, ip, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(nowIso(), user?.kind || 'system', user?.id || null, user?.name || null, user?.code || null, oneLine(action, 300), kind, details ? clean(details, 1000) : null,
        request?.headers.get('CF-Connecting-IP') || null, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after)).run();
  } catch (e) { console.error('[matchday kitchen] activity', e); }
}
export async function activityPage(db, { userId = '', day = '', page = 1, limit = 50, all = false } = {}) {
  await ensureKitchenSchema(db);
  const w = [], b = [];
  if (userId) { w.push('actor_id = ?'); b.push(userId); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) { w.push('at >= ? AND at < ?'); b.push(new Date(Date.parse(`${day}T00:00:00Z`) - 3600e3).toISOString(), new Date(Date.parse(`${day}T00:00:00Z`) + 23 * 3600e3).toISOString()); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM mk_activity ${where}`).bind(...b).first()).n;
  const p = Math.max(1, Number(page) || 1);
  const rows = all
    ? (await db.prepare(`SELECT * FROM mk_activity ${where} ORDER BY id DESC LIMIT 20000`).bind(...b).all()).results
    : (await db.prepare(`SELECT * FROM mk_activity ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).bind(...b, limit, (p - 1) * limit).all()).results;
  return { total, page: p, pages: Math.max(1, Math.ceil(total / limit)), rows };
}

// ── Staff accounts (managed by the Super Admins from the Staff accounts page) ──
export function staffIdProblem(id) {
  if (!id) return 'Enter a Staff ID, e.g. LSK-001.';
  if (id.length > 20 || !STAFF_ID_RE.test(id)) return 'The Staff ID can only have letters, numbers and dashes, e.g. LSK-001.';
  return null;
}
// Login codes: 8 numbers, personal, working until a new one is made. Only a hash is kept.
const codeHash = (env, digits) => sha256Hex(`mk-code:${env.SESSION_SECRET || 'lobi'}:${digits}`);
const showCode = d => `${d.slice(0, 4)}-${d.slice(4)}`;
async function newLoginCode(env) {
  for (let i = 0; i < 8; i++) {
    const n = crypto.getRandomValues(new Uint32Array(1))[0] % 100000000;
    const digits = String(n).padStart(8, '0');
    if (/^(\d)\1+$/.test(digits) || digits === '12345678') continue;
    const hash = await codeHash(env, digits);
    if (!(await env.DB.prepare(`SELECT 1 FROM mk_staff WHERE login_code_hash = ?`).bind(hash).first())) return { digits, hash };
  }
  throw new Error('Could not make a login code.');
}
async function nextStaffId(db) {
  let n = ((await db.prepare(`SELECT COUNT(*) AS n FROM mk_staff`).first())?.n || 0) + 1;
  for (;;) {
    const id = `LSK-${String(n).padStart(3, '0')}`;
    if (!(await db.prepare(`SELECT 1 FROM mk_staff WHERE staff_id = ?`).bind(id).first())) return id;
    n++;
  }
}
// Only a Super Admin adds or changes a kitchen supervisor; supervisors manage cooks and pass staff.
const SUPER_ONLY = 'Only a Super Admin can add or change a kitchen supervisor.';
const staffView = s => ({ id: s.id, staffId: s.staff_id, name: s.full_name, role: s.role, roleLabel: ROLES[s.role] || s.role, active: !!s.is_active,
  hasCode: !!s.login_code_hash, lastLogin: s.last_login_at, createdAt: s.created_at, venueId: s.venue_id || DEFAULT_VENUE });
export async function listStaff(db) {
  await ensureKitchenSchema(db);
  return (await db.prepare(`SELECT * FROM mk_staff ORDER BY is_active DESC, full_name`).all()).results.map(staffView);
}
async function endSessions(db, userId, why) {
  await db.prepare(`UPDATE mk_sessions SET ended_at = ?, ended_why = ? WHERE user_id = ? AND ended_at IS NULL`).bind(nowIso(), why, userId).run();
}
export async function createStaff(env, by, request, v) {
  const db = env.DB;
  await ensureKitchenSchema(db);
  const name = oneLine(v.name, 80), role = String(v.role || '');
  const given = String(v.staffId || '').trim().toUpperCase();
  const bad = (given ? staffIdProblem(given) : null) || (name.length < 2 ? "Enter the person's full name." : null) || (!ROLES[role] ? 'Choose a role.' : null);
  if (bad) return { error: bad };
  if (role === 'supervisor' && by.kind !== 'admin') return { error: SUPER_ONLY, status: 403 };
  if (given && await db.prepare(`SELECT id FROM mk_staff WHERE staff_id = ?`).bind(given).first()) return { error: 'That Staff ID is already used. Choose another.' };
  const staffId = given || await nextStaffId(db);
  const id = newId('mks'), at = nowIso(), code = await newLoginCode(env);
  // A supervisor adds people to their own venue; a Super Admin can choose.
  const venueId = by.kind === 'admin' ? (String(v.venueId || '') || DEFAULT_VENUE) : (by.venueId || DEFAULT_VENUE);
  await db.prepare(`INSERT INTO mk_staff (id, staff_id, full_name, role, password_hash, login_code_hash, created_by, created_at, updated_at, venue_id) VALUES (?, ?, ?, ?, 'login-code', ?, ?, ?, ?, ?)`)
    .bind(id, staffId, name, role, code.hash, by.code || by.name, at, at, venueId).run();
  await mkLog(db, by, `Created staff account ${name} (${staffId}), ${ROLES[role]}`, { kind: 'staff', request, after: { name, staffId, role, venueId, active: true } });
  return { ok: true, id, staffId, name, loginCode: showCode(code.digits) };
}
export async function updateStaff(env, by, request, id, v) {
  const db = env.DB;
  await ensureKitchenSchema(db);
  const s = await db.prepare(`SELECT * FROM mk_staff WHERE id = ?`).bind(String(id)).first();
  if (!s) return { error: 'That staff account no longer exists.' };
  const name = v.name !== undefined ? oneLine(v.name, 80) : s.full_name;
  const role = v.role !== undefined ? String(v.role) : s.role;
  const active = v.active !== undefined ? (v.active ? 1 : 0) : s.is_active;
  const venueId = by.kind === 'admin' && v.venueId !== undefined ? String(v.venueId) : (s.venue_id || DEFAULT_VENUE);
  // A supervisor only manages people at their own venue.
  if (by.kind !== 'admin' && by.venueId && (s.venue_id || DEFAULT_VENUE) !== by.venueId) return { error: 'That person works at another venue.', status: 403 };
  if (name.length < 2) return { error: "Enter the person's full name." };
  if (!ROLES[role]) return { error: 'Choose a role.' };
  if (by.kind !== 'admin' && (s.role === 'supervisor' || role === 'supervisor')) return { error: SUPER_ONLY, status: 403 };
  const code = v.newCode === true ? await newLoginCode(env) : null;
  const changes = [];
  if (name !== s.full_name) changes.push(`name ${s.full_name} → ${name}`);
  if (role !== s.role) changes.push(`role ${ROLES[s.role] || s.role} → ${ROLES[role]}`);
  if (active !== s.is_active) changes.push(active ? 'can sign in again' : 'switched off');
  if (code) changes.push('new login code');
  if (venueId !== (s.venue_id || DEFAULT_VENUE)) changes.push('venue changed');
  if (!changes.length) return { ok: true, unchanged: true };
  await db.prepare(`UPDATE mk_staff SET full_name = ?, role = ?, is_active = ?, venue_id = ?, ${code ? 'login_code_hash = ?, ' : ''}updated_at = ? WHERE id = ?`)
    .bind(...[name, role, active, venueId, ...(code ? [code.hash] : []), nowIso(), s.id]).run();
  // A new code or a switched-off account signs the person out on every tablet straight away.
  if (code || !active) {
    await endSessions(db, s.id, code ? 'new login code' : 'account switched off');
    // No more order alerts on their devices (they turn back on when the person next signs in, if allowed).
    await db.prepare(`UPDATE push_subs SET is_active = 0 WHERE staff_id = ? AND mk_app = 1`).bind(s.id).run().catch(() => {});
  }
  await mkLog(db, by, `Changed staff account ${name} (${s.staff_id}): ${changes.join(', ')}`, { kind: 'staff', request,
    before: { name: s.full_name, role: s.role, venueId: s.venue_id || DEFAULT_VENUE, active: !!s.is_active }, after: { name, role, venueId, active: !!active } });
  return { ok: true, staffId: s.staff_id, name, ...(code ? { loginCode: showCode(code.digits) } : {}) };
}

// ── Sign-in and sessions ──
const cookieValue = (request, name) => ((request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`)) || [])[1] || null;
const sessionCookie = token => `${MK_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${MAX_MS / 1000}`;
export const clearKitchenCookie = () => `${MK_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
const FAIL = 'The email or password is not right.';
const DUMMY_HASH = '100000:00000000000000000000000000000000:00';
const staffActor = s => ({ kind: 'staff', id: s.id, name: s.full_name, code: s.staff_id });
const adminActor = u => ({ kind: 'admin', id: u.id, name: u.name || u.email, code: u.email });

async function startSession(db, request, kind, userId) {
  const token = randomToken(), sid = await sha256Hex(token), csrf = randomToken(18), at = nowIso();
  await db.prepare(`INSERT INTO mk_sessions (id, kind, user_id, csrf, created_at, last_seen, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(sid, kind, userId, csrf, at, at, request.headers.get('CF-Connecting-IP') || null, oneLine(request.headers.get('User-Agent') || '', 300)).run();
  return { cookie: sessionCookie(token), csrf };
}

/** The Super Admin's second step: the authenticator code or a backup code. Returns an error text, or null. */
async function secondStep(env, db, u, otp, request) {
  const code = String(otp || '').trim();
  if (!(await rateLimit(db, `mdk-otp:${u.id}`, 8, 900))) return 'Too many tries. Please wait 15 minutes.';
  if (looksLikeBackupCode(code)) return (await useBackupCode(db, u.id, code)) === null ? 'That backup code is not right or has already been used.' : null;
  const step = await verifyTotp(u.totp_secret, code, u.totp_last_step);
  if (!step) return 'That code is not right or has already been used. Wait for the next code and try again.';
  const r = await db.prepare(`UPDATE admin_users SET totp_last_step = ? WHERE id = ? AND totp_last_step < ?`).bind(step, u.id, step).run();
  return r.meta?.changes ? null : 'That code has already been used. Wait for the next code.';
}

export async function signIn(env, request, { login, password, loginCode, otp }) {
  const db = env.DB;
  await ensureFanSchema(db); await ensureKitchenSchema(db);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await rateLimit(db, `mdk-login:${ip}`, 40, 900))) return { error: 'Too many attempts from this connection. Please wait 15 minutes.', status: 429 };
  const raw = String(login || '').trim().slice(0, 120);
  const pw = String(password || '');

  // Kitchen staff: their personal login code (no email or password).
  if (loginCode !== undefined) {
    const digits = String(loginCode || '').replace(/\D/g, '');
    if (digits.length !== 8) return { error: 'Your login code has 8 numbers, e.g. 1234-5678.', status: 400 };
    const key = `mdk-code-fail:${ip}`;
    const now = Math.floor(Date.now() / 1000), start = now - (now % 900);
    const row = await db.prepare(`SELECT window_start, count FROM rate_limits WHERE key = ?`).bind(key).first();
    if (row && row.window_start === start && row.count >= CODE_FAILS) return { error: 'Too many wrong codes from this connection. Please wait 15 minutes.', status: 429 };
    const st = await db.prepare(`SELECT * FROM mk_staff WHERE login_code_hash = ?`).bind(await codeHash(env, digits)).first();
    if (!st) {
      await rateLimit(db, key, 1e6, 900);
      await mkLog(db, { kind: 'public', name: 'Unknown', code: '' }, 'Sign-in refused: wrong login code', { kind: 'sign_in', request });
      return { error: 'That login code is not right. Check it, or ask your kitchen supervisor.', status: 401 };
    }
    const person = staffActor(st);
    if (!st.is_active) {
      await mkLog(db, person, 'Sign-in refused: account switched off', { kind: 'sign_in', request });
      return { error: 'This account is switched off. Ask a kitchen supervisor or a Super Admin.', status: 403 };
    }
    await db.prepare(`UPDATE mk_staff SET last_login_at = ? WHERE id = ?`).bind(nowIso(), st.id).run();
    const sess = await startSession(db, request, 'staff', st.id);
    await mkLog(db, person, 'Signed in', { kind: 'sign_in', request });
    return { ok: true, cookie: sess.cookie };
  }

  // A website Super Admin, with their website email.
  if (raw.includes('@')) {
    const email = raw.toLowerCase();
    const key = `mdk-email-fail:${email}`;
    const row = await db.prepare(`SELECT window_start, count FROM rate_limits WHERE key = ?`).bind(key).first();
    const win = Math.floor(Date.now() / 1000), start = win - (win % 900);
    if (row && row.window_start === start && row.count >= LOCK_AFTER) {
      await mkLog(db, { kind: 'public', name: email, code: email }, 'Sign-in refused: locked after too many wrong passwords', { kind: 'sign_in', request });
      return { error: 'Too many wrong passwords. Wait 15 minutes and try again.', status: 423 };
    }
    const u = await db.prepare(`SELECT * FROM admin_users WHERE email = ?`).bind(email).first().catch(() => null);
    const ok = await verifyPassword(pw, u?.password_hash || DUMMY_HASH).catch(() => false);
    const allowed = ok && u && u.active && !u.disabled_at && isFullSuperAdmin(env, u);
    if (!allowed) {
      await rateLimit(db, key, 1e6, 900);
      await mkLog(db, { kind: 'public', name: email, code: email }, ok && u ? 'Sign-in refused: only website Super Admins can sign in with an email' : 'Wrong email or password', { kind: 'sign_in', request });
      return { error: ok && u ? 'Only website Super Admins can sign in with an email. Kitchen staff use their login code.' : FAIL, status: 401 };
    }
    // Super Admins use two-step sign-in here too, with the same authenticator as the website admin.
    // A kitchen session still opens only the kitchen, never the website admin.
    const testAccount = env.STAFF_TEST_PASSWORDS === '1' && u.test_account;
    if (!testAccount) {
      if (!u.totp_enabled) return { error: 'Set up two-step login in the website admin first (My account), then sign in here.', status: 403 };
      if (!String(otp || '').trim()) return { error: 'Enter the 6-digit code from your authenticator app (or a backup code).', needCode: true, status: 401 };
      const bad = await secondStep(env, db, u, otp, request);
      if (bad) { await mkLog(db, adminActor(u), 'Sign-in refused: wrong two-step code', { kind: 'sign_in', request }); return { error: bad, needCode: true, status: 401 }; }
    }
    const s = await startSession(db, request, 'admin', u.id);
    await mkLog(db, adminActor(u), 'Signed in', { kind: 'sign_in', request });
    return { ok: true, cookie: s.cookie };
  }

  return { error: 'Kitchen staff sign in with their login code. Super Admins use their website email.', status: 400 };
}

/** The kitchen session for this request, or null (ends idle, expired, switched-off or no-longer-Super-Admin sessions). */
export async function getKitchenSession(request, env, { touch = true } = {}) {
  const token = cookieValue(request, MK_COOKIE);
  if (!token || !/^[\w-]{20,80}$/.test(token)) return null;
  const db = env.DB;
  await ensureKitchenSchema(db);
  const s = await db.prepare(`SELECT * FROM mk_sessions WHERE id = ? AND ended_at IS NULL`).bind(await sha256Hex(token)).first();
  if (!s) return null;
  let user = null;
  if (s.kind === 'staff') {
    const st = await db.prepare(`SELECT * FROM mk_staff WHERE id = ?`).bind(s.user_id).first();
    if (st?.is_active) user = { ...staffActor(st), role: st.role, roleLabel: ROLES[st.role] || st.role, firstName: st.full_name.split(' ')[0], venueId: st.venue_id || DEFAULT_VENUE };
  } else {
    const u = await db.prepare(`SELECT * FROM admin_users WHERE id = ?`).bind(s.user_id).first().catch(() => null);
    if (u && u.active && !u.disabled_at && isFullSuperAdmin(env, u)) user = { ...adminActor(u), role: 'super_admin', roleLabel: 'Super admin', email: u.email, firstName: String(u.name || u.email).split(/[ @]/)[0] };
  }
  const end = async (why, log) => {
    await db.prepare(`UPDATE mk_sessions SET ended_at = ?, ended_why = ? WHERE id = ?`).bind(nowIso(), why, s.id).run();
    if (log && user) await mkLog(db, user, log, { kind: 'sign_out' });
  };
  const now = Date.now();
  if (!user) { await end('account switched off or no longer allowed'); return null; }
  if (now - Date.parse(s.last_seen) > IDLE_MS) { await end('no activity', 'Signed out automatically (no activity)'); return null; }
  if (now - Date.parse(s.created_at) > MAX_MS) { await end('14 hours', 'Signed out automatically (14 hours)'); return null; }
  if (touch && now - Date.parse(s.last_seen) > 20e3) await db.prepare(`UPDATE mk_sessions SET last_seen = ? WHERE id = ?`).bind(nowIso(), s.id).run();
  return { id: s.id, csrf: s.csrf, user };
}
export async function signOut(db, session, request, idle = false) {
  await db.prepare(`UPDATE mk_sessions SET ended_at = ?, ended_why = ? WHERE id = ? AND ended_at IS NULL`).bind(nowIso(), idle ? 'no activity (Still there? not answered)' : 'signed out', session.id).run();
  await mkLog(db, session.user, idle ? 'Signed out automatically (no tap for 20 minutes)' : 'Signed out', { kind: 'sign_out', request });
}
/** Changes must come from the MatchDay Kitchen pages: same website and the session's token. */
export function csrfProblem(request, session) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return 'This change must be made from MatchDay Kitchen.';
  if (request.headers.get('X-CSRF-Token') !== session.csrf) return 'Please reload the page and try again.';
  return null;
}

// ── Shifts ──
export async function openShift(db, userId) {
  await ensureKitchenSchema(db);
  return db.prepare(`SELECT * FROM mk_shifts WHERE user_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`).bind(userId).first();
}
export async function shiftState(db, user) {
  const open = await openShift(db, user.id);
  const onNow = (await db.prepare(`SELECT name, code, role, started_at FROM mk_shifts WHERE ended_at IS NULL AND started_at > ? ORDER BY started_at`).bind(new Date(Date.now() - 18 * 3600e3).toISOString()).all()).results
    .map(r => ({ name: r.name, code: r.code, role: ROLES[r.role] || (r.role === 'super_admin' ? 'Super admin' : r.role || ''), since: r.started_at }));
  const last = (await db.prepare(`SELECT started_at, ended_at FROM mk_shifts WHERE user_id = ? ORDER BY started_at DESC LIMIT 10`).bind(user.id).all()).results;
  return { onShift: !!open, since: open?.started_at || null, onNow, last };
}
export async function startShift(db, user, request) {
  if (await openShift(db, user.id)) return { error: 'Your shift has already started.' };
  await db.prepare(`INSERT INTO mk_shifts (id, user_id, name, code, role, started_at, venue_id) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(newId('sh'), user.id, user.name, user.code, user.role, nowIso(), user.venueId || DEFAULT_VENUE).run();
  await mkLog(db, user, 'Started shift', { kind: 'shift', request });
  return { ok: true };
}
export async function endShift(db, user, request) {
  const open = await openShift(db, user.id);
  if (!open) return { error: "You haven't started a shift." };
  const at = nowIso();
  await db.prepare(`UPDATE mk_shifts SET ended_at = ? WHERE id = ?`).bind(at, open.id).run();
  const mins = Math.round((Date.parse(at) - Date.parse(open.started_at)) / 60000);
  await mkLog(db, user, 'Ended shift', { kind: 'shift', details: `${Math.floor(mins / 60)} h ${mins % 60} min`, request });
  return { ok: true };
}

// ── Handover notes ──
export async function listNotes(db) {
  await ensureKitchenSchema(db);
  return (await db.prepare(`SELECT id, user_id, author_name, author_code, text, pinned, created_at FROM mk_notes WHERE deleted_at IS NULL ORDER BY pinned DESC, created_at DESC LIMIT 200`).all()).results;
}
export async function noteAction(db, user, perms, request, { action, id, text }) {
  await ensureKitchenSchema(db);
  if (action === 'add') {
    const t = clean(text, 1000);
    if (t.length < 2) return { error: 'Write the note first.' };
    await db.prepare(`INSERT INTO mk_notes (id, user_id, author_name, author_code, text, created_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(newId('note'), user.id, user.name, user.code, t, nowIso()).run();
    await mkLog(db, user, 'Posted a handover note', { kind: 'note', details: t, request });
    return { ok: true };
  }
  const n = await db.prepare(`SELECT * FROM mk_notes WHERE id = ? AND deleted_at IS NULL`).bind(String(id)).first();
  if (!n) return { error: 'That note has already been deleted.' };
  if (action === 'pin' || action === 'unpin') {
    if (!perms.notes) return { error: "Your role can't pin notes. Ask a kitchen supervisor.", status: 403 };
    await db.prepare(`UPDATE mk_notes SET pinned = ? WHERE id = ?`).bind(action === 'pin' ? 1 : 0, n.id).run();
    await mkLog(db, user, `${action === 'pin' ? 'Pinned' : 'Unpinned'} a handover note by ${n.author_name}`, { kind: 'note', details: n.text, request });
    return { ok: true };
  }
  if (action === 'delete') {
    if (!perms.notes && n.user_id !== user.id) return { error: 'You can only delete your own notes.', status: 403 };
    await db.prepare(`UPDATE mk_notes SET deleted_at = ?, deleted_by = ? WHERE id = ?`).bind(nowIso(), `${user.name} (${user.code})`, n.id).run();
    await mkLog(db, user, `Deleted a handover note by ${n.author_name}`, { kind: 'note', details: n.text, request });
    return { ok: true };
  }
  return { error: 'Unknown action.' };
}
