// Squad & Staff Data Portal: the private link where authorised club staff record
// player, coach and staff profiles. It has ONE shared account (username +
// password, set by a Super Admin) and its own sessions, completely separate from
// the admin back end: the portal cookie never opens an admin page or API (the
// admin middlewares answer 403 to it), and the portal API only accepts portal
// sessions.
//
// Security: PBKDF2-SHA256 password hash (password.js: the Workers runtime has no
// argon2id/bcrypt); lock for 15 minutes after 5 failed sign-ins; Turnstile after
// 3 failures; rate limits per connection; HttpOnly + Secure + SameSite=Strict
// cookie; a CSRF token on every change; sign-out after 60 minutes without
// activity (12 hours at most). The person's name is asked at sign-in and
// recorded with every action ("Grace (Squad Data Portal)").
import { hashPassword, verifyPassword } from './password.js';
import { ensureFanSchema, rateLimit, checkTurnstile } from './fans.js';
import { logAdminAction } from './adminSession.js';

export const PORTAL_DEFAULT_PATH = '/staff/squad-data';
/** The portal address (PORTAL_PATH, under /staff/; default /staff/squad-data). */
export function portalPath(env) {
  const p = String(env.PORTAL_PATH || PORTAL_DEFAULT_PATH).trim().replace(/\/+$/, '');
  return /^\/staff\/[a-z0-9][a-z0-9-]{2,60}$/i.test(p) ? p : PORTAL_DEFAULT_PATH;
}
export const portalLink = (env, origin) => `${String(env.SITE_URL || origin || 'https://lobistarsfc.com').replace(/\/+$/, '')}${portalPath(env)}`;

const COOKIE = 'ls_squad';
const DEVICE_COOKIE = 'ls_squad_dev';
export const IDLE_MS = 60 * 60e3;
const MAX_MS = 12 * 3600e3;
const LOCK_AFTER = 5, LOCK_MS = 15 * 60e3, TURNSTILE_AFTER = 3;
export const PORTAL_ACTOR_ROLE = 'squad_portal';

const nowIso = () => new Date().toISOString();
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
export async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const json = (d, status = 200, headers = {}) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', ...headers } });
export { json as portalJson };

let ready = false;
export async function ensurePortalSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS squad_portal_settings (key TEXT PRIMARY KEY, value TEXT, updated_by TEXT, updated_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS squad_portal_sessions (id TEXT PRIMARY KEY, name TEXT NOT NULL, device_id TEXT, device TEXT, pw_version INTEGER NOT NULL,
      csrf TEXT NOT NULL, created_at TEXT NOT NULL, last_seen TEXT NOT NULL, ended_at TEXT, ended_why TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_squad_sessions_open ON squad_portal_sessions (ended_at, last_seen)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS squad_portal_devices (id TEXT PRIMARY KEY, device TEXT, first_name TEXT, first_seen TEXT NOT NULL, last_seen TEXT, seen_by_admin INTEGER NOT NULL DEFAULT 0)`),
  ]);
  ready = true;
}

const DEFAULTS = { username: 'lobi-squad', enabled: '1', season: '2026/27', pw_version: '1', failed: '0', locked_until: '' };
export async function getPortalSettings(db) {
  await ensurePortalSchema(db);
  const rows = (await db.prepare(`SELECT key, value FROM squad_portal_settings`).all()).results;
  const s = { ...DEFAULTS };
  for (const r of rows) s[r.key] = r.value ?? '';
  return s;
}
export async function setPortalSetting(db, key, value, by = 'system') {
  await ensurePortalSchema(db);
  await db.prepare(`INSERT INTO squad_portal_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .bind(key, value == null ? null : String(value), by, nowIso()).run();
}

/** A strong password that is easy to read out: 4 groups of 5 (no 0/O, 1/l/I). */
export function newPortalPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const r = crypto.getRandomValues(new Uint8Array(20));
  const s = [...r].map(b => chars[b % chars.length]).join('');
  return `${s.slice(0, 5)}-${s.slice(5, 10)}-${s.slice(10, 15)}-${s.slice(15, 20)}`;
}

/** "Chrome on Windows", "Safari on iPhone"… (nothing stored that identifies the person). */
export function deviceLabel(ua) {
  const u = String(ua || '');
  const os = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac OS X|Macintosh/.test(u) ? 'Mac' : /Linux/.test(u) ? 'Linux' : 'a device';
  const br = /Edg\//.test(u) ? 'Edge' : /OPR\/|Opera/.test(u) ? 'Opera' : /SamsungBrowser/.test(u) ? 'Samsung Internet' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'a browser';
  return `${br} on ${os}`;
}

const cookieValue = (request, name) => ((request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`)) || [])[1] || null;
const sessionCookie = token => `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${MAX_MS / 1000}`;
export const clearPortalCookie = () => `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
const deviceCookie = id => `${DEVICE_COOKIE}=${id}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${400 * 86400}`;
export const hasPortalCookie = request => !!cookieValue(request, COOKIE);

/** The actor written in the Activity Log for portal actions. */
export const portalActor = s => ({ id: 'squad-portal', name: `${s?.name || 'Someone'} (Squad Data Portal)`, email: 'squad-portal', role: PORTAL_ACTOR_ROLE });

/** Is Turnstile needed for the next sign-in (3 or more recent failures)? */
export async function signInState(env, request) {
  const db = env.DB;
  const s = await getPortalSettings(db);
  const locked = s.locked_until && Date.parse(s.locked_until) > Date.now();
  return { open: s.enabled === '1', locked: !!locked, lockedUntil: locked ? s.locked_until : null, needTurnstile: Number(s.failed) >= TURNSTILE_AFTER, season: s.season, configured: !!s.password_hash };
}

/** Sign in. Returns { ok, session, cookies } or { error, status, needTurnstile }. */
export async function signIn(env, request, { username, password, name, turnstile }) {
  const db = env.DB;
  await ensureFanSchema(db);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await rateLimit(db, `squadportal:${ip}`, 30, 900))) return { error: 'Too many attempts from this connection. Please wait 15 minutes.', status: 429 };
  const s = await getPortalSettings(db);
  if (s.enabled !== '1') return { error: 'The portal is currently closed.', status: 403, closed: true };
  if (!s.password_hash) return { error: 'The portal has not been set up yet. Ask a Super Admin for the login.', status: 403 };
  if (s.locked_until && Date.parse(s.locked_until) > Date.now()) {
    const mins = Math.max(1, Math.ceil((Date.parse(s.locked_until) - Date.now()) / 60000));
    return { error: `Too many wrong passwords. The portal sign-in is locked for ${mins} more minute${mins === 1 ? '' : 's'}.`, status: 423 };
  }
  const who = String(name || '').replace(/[\u0000-\u001F\u007F<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (who.length < 2) return { error: 'Please enter your name.', status: 400, field: 'name' };
  const failed = Number(s.failed) || 0;
  if (failed >= TURNSTILE_AFTER && !(await checkTurnstile(env, turnstile, ip))) return { error: 'Please complete the human check.', status: 400, needTurnstile: true };
  const okUser = String(username || '').trim().toLowerCase() === String(s.username || '').toLowerCase();
  const okPass = await verifyPassword(String(password || ''), s.password_hash).catch(() => false);
  if (!okUser || !okPass) {
    const n = failed + 1;
    await setPortalSetting(db, 'failed', n);
    if (n >= LOCK_AFTER) {
      await setPortalSetting(db, 'locked_until', new Date(Date.now() + LOCK_MS).toISOString());
      await setPortalSetting(db, 'failed', 0);
      await logAdminAction(db, { id: 'squad-portal', name: 'Squad Data Portal', email: 'squad-portal' }, 'squad_portal_locked', `Squad Data Portal sign-in locked for 15 minutes after ${LOCK_AFTER} wrong passwords (last try by "${who}", ${deviceLabel(request.headers.get('User-Agent'))})`);
      return { error: 'Too many wrong passwords. The portal sign-in is locked for 15 minutes.', status: 423 };
    }
    return { error: 'The username or password is not right.', status: 401, needTurnstile: n >= TURNSTILE_AFTER };
  }
  await setPortalSetting(db, 'failed', 0);
  await setPortalSetting(db, 'locked_until', '');
  // Session.
  const token = randomToken(), id = await sha256Hex(token), csrf = randomToken(18), device = deviceLabel(request.headers.get('User-Agent'));
  let deviceId = cookieValue(request, DEVICE_COOKIE);
  if (!deviceId || !/^[\w-]{20,60}$/.test(deviceId)) deviceId = randomToken(18);
  const at = nowIso();
  await db.prepare(`INSERT INTO squad_portal_sessions (id, name, device_id, device, pw_version, csrf, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, who, deviceId, device, Number(s.pw_version) || 1, csrf, at, at).run();
  // A device never seen before: the Super Admins are told (notification bell).
  const known = await db.prepare(`SELECT id FROM squad_portal_devices WHERE id = ?`).bind(deviceId).first();
  if (known) await db.prepare(`UPDATE squad_portal_devices SET last_seen = ? WHERE id = ?`).bind(at, deviceId).run();
  else await db.prepare(`INSERT INTO squad_portal_devices (id, device, first_name, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)`).bind(deviceId, device, who, at, at).run();
  await logAdminAction(db, portalActor({ name: who }), 'squad_portal_signin', `${who} signed in to the Squad Data Portal (${device}${known ? '' : ', a new device'})`);
  return { ok: true, session: { name: who, csrf, device }, cookies: [sessionCookie(token), deviceCookie(deviceId)], newDevice: !known };
}

/** The portal session for this request, or null. Updates "last seen" (activity) at most once a minute. */
export async function getPortalSession(request, env, { touch = true } = {}) {
  const token = cookieValue(request, COOKIE);
  if (!token || !/^[\w-]{20,80}$/.test(token)) return null;
  const db = env.DB;
  await ensurePortalSchema(db);
  const s = await db.prepare(`SELECT * FROM squad_portal_sessions WHERE id = ? AND ended_at IS NULL`).bind(await sha256Hex(token)).first();
  if (!s) return null;
  const set = await getPortalSettings(db);
  const now = Date.now();
  const end = why => db.prepare(`UPDATE squad_portal_sessions SET ended_at = ?, ended_why = ? WHERE id = ?`).bind(nowIso(), why, s.id).run();
  if (set.enabled !== '1') { await end('portal closed'); return null; }
  if (Number(s.pw_version) !== (Number(set.pw_version) || 1)) { await end('password changed'); return null; }
  if (now - Date.parse(s.last_seen) > IDLE_MS) { await end('no activity for 60 minutes'); return null; }
  if (now - Date.parse(s.created_at) > MAX_MS) { await end('12 hours'); return null; }
  if (touch && now - Date.parse(s.last_seen) > 60e3) await db.prepare(`UPDATE squad_portal_sessions SET last_seen = ? WHERE id = ?`).bind(nowIso(), s.id).run();
  return { id: s.id, name: s.name, csrf: s.csrf, device: s.device, deviceId: s.device_id, since: s.created_at, lastSeen: s.last_seen, season: set.season };
}

/**
 * Guard for the portal's own API. write: also checks the request comes from this
 * website (Origin) and carries the session's CSRF token (X-CSRF-Token).
 * Returns { session } or { denied }.
 */
export async function requirePortal(request, env, { write = false } = {}) {
  const session = await getPortalSession(request, env, { touch: request.headers.get('X-Portal-Activity') !== '0' });
  if (!session) return { denied: json({ error: 'Please sign in to the portal again.', signedOut: true }, 401, { 'Set-Cookie': clearPortalCookie() }) };
  if (write) {
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) return { denied: json({ error: 'This request came from another website and was refused.' }, 403) };
    if (request.headers.get('X-CSRF-Token') !== session.csrf) return { denied: json({ error: 'The page is out of date. Please reload it.' }, 403) };
  }
  return { session };
}

export async function signOut(env, session, why = 'signed out') {
  await env.DB.prepare(`UPDATE squad_portal_sessions SET ended_at = ?, ended_why = ? WHERE id = ? AND ended_at IS NULL`).bind(nowIso(), why, session.id).run();
}
export async function signOutAll(env, by, why = 'signed out by a Super Admin') {
  await ensurePortalSchema(env.DB);
  const r = await env.DB.prepare(`UPDATE squad_portal_sessions SET ended_at = ?, ended_why = ? WHERE ended_at IS NULL`).bind(nowIso(), why).run();
  return r.meta?.changes || 0;
}
export async function openSessions(db) {
  await ensurePortalSchema(db);
  const since = new Date(Date.now() - IDLE_MS).toISOString();
  return (await db.prepare(`SELECT id, name, device, created_at, last_seen FROM squad_portal_sessions WHERE ended_at IS NULL AND last_seen > ? ORDER BY last_seen DESC LIMIT 50`).bind(since).all()).results;
}
/** New devices the Super Admins have not seen yet (notification bell). */
export async function unseenDevices(db) {
  await ensurePortalSchema(db);
  return (await db.prepare(`SELECT * FROM squad_portal_devices WHERE seen_by_admin = 0 ORDER BY first_seen DESC LIMIT 20`).all()).results;
}

/** Super Admin: a new password (returned once). Every portal session is signed out. */
export async function resetPortalPassword(env, admin) {
  const db = env.DB;
  const s = await getPortalSettings(db);
  const password = newPortalPassword();
  await setPortalSetting(db, 'password_hash', await hashPassword(password), admin.name);
  await setPortalSetting(db, 'pw_version', (Number(s.pw_version) || 1) + 1, admin.name);
  await setPortalSetting(db, 'failed', 0, admin.name);
  await setPortalSetting(db, 'locked_until', '', admin.name);
  await setPortalSetting(db, 'reset_request', '', admin.name);
  const n = await signOutAll(env, admin, 'password changed');
  await logAdminAction(db, admin, 'squad_portal_password', `New Squad Data Portal password generated${n ? ` (${n} portal session${n === 1 ? '' : 's'} signed out)` : ''}`);
  return password;
}
/**
 * "Forgot the password?" on the sign-in page. The password is shared, so it is
 * never sent out: the request (name, how to reach them, device) goes to the
 * Super Admins (email + bell), who generate a new password on the settings page
 * and send it by WhatsApp. Limited to 3 an hour per connection and 10 a day.
 */
export async function requestNewPassword(env, request, { name, contact, turnstile }) {
  const db = env.DB;
  await ensureFanSchema(db);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const clean = (v, n) => String(v || '').replace(/[\u0000-\u001F\u007F<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const who = clean(name, 60), reach = clean(contact, 80);
  if (who.length < 2) return { error: 'Please enter your name.', status: 400, field: 'name' };
  if (reach.length < 5) return { error: 'Please enter your WhatsApp number or email, so the new password can reach you.', status: 400, field: 'contact' };
  if (!(await rateLimit(db, `squadforgot:${ip}`, 3, 3600)) || !(await rateLimit(db, 'squadforgot:all', 10, 86400))) return { error: 'A request was already sent. A Super Admin will contact you.', status: 429 };
  const s = await getPortalSettings(db);
  if (Number(s.failed) >= TURNSTILE_AFTER && !(await checkTurnstile(env, turnstile, ip))) return { error: 'Please complete the human check.', status: 400, needTurnstile: true };
  const req = { name: who, contact: reach, device: deviceLabel(request.headers.get('User-Agent')), at: new Date().toISOString() };
  await setPortalSetting(db, 'reset_request', JSON.stringify(req), who);
  await logAdminAction(db, { id: 'squad-portal', name: `${who} (Squad Data Portal)`, email: 'squad-portal' }, 'squad_portal_reset_request', `${who} asked for a new Squad Data Portal password (reach them on ${reach}; ${req.device})`);
  return { ok: true, request: req };
}
export function resetRequest(s) { try { return s.reset_request ? JSON.parse(s.reset_request) : null; } catch { return null; } }

export { newPortalPassword as _newPortalPassword, randomToken };
