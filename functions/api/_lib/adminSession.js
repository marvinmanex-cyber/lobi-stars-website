import { sign, verify } from './crypto.js';
import { ensureSecuritySchema, liveSession, touchSession, securitySettings, ipAllowed, allowlistApplies, GRACE_DAYS } from './adminSecurity.js';
import { clientIp } from './fans.js';
import { roleOf } from './adminRoles.js';
import { isFullSuperAdmin } from './superAdmins.js';
import { helperId, helperAdmin } from './helpers.js';
import { writeLog } from './activityLog.js';

// Staff (admin) sign-in.
//
// - The OWNER signs in with the shared ADMIN_CODE secret: a Super Admin and
//   the way back in if everything else fails (every use is emailed to the
//   Super Admins; see login.js).
// - STAFF sign in with their own email + password (admin_users table), plus a
//   code from their authenticator app when two-step login is on.
//
// Each sign-in is a row in admin_sessions; the "ls_admin" cookie holds its id,
// signed so made-up ids are refused without a database look-up. A session ends
// after 30 minutes without activity, after 12 hours, on "Log out", "Log out of
// all devices", or when a Super Admin deactivates the account. The signing key
// includes ADMIN_CODE, so changing the code signs everyone out.
const COOKIE_NAME = 'ls_admin';
export const OWNER = { id: 'owner', name: 'Owner (admin code)', email: '', role: 'owner', canExport: true };

function key(env) {
  return `${env.SESSION_SECRET || ''}|admin|${env.ADMIN_CODE}`;
}

let schemaReady = false;
export async function ensureAdminSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      can_export_fan_data INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT
    )`),
    // Audit trail: every export, deletion and unsubscribe done by staff.
    db.prepare(`CREATE TABLE IF NOT EXISTS admin_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      staff_id TEXT NOT NULL,
      staff_name TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT
    )`),
  ]);
  // Two-step login (authenticator app codes).
  const cols = new Set((await db.prepare(`PRAGMA table_info(admin_users)`).all()).results.map(r => r.name));
  for (const [name, type] of [['totp_secret', 'TEXT'], ['totp_enabled', 'INTEGER NOT NULL DEFAULT 0'], ['totp_pending', 'TEXT'], ['totp_last_step', 'INTEGER NOT NULL DEFAULT 0']]) {
    if (!cols.has(name)) {
      try { await db.prepare(`ALTER TABLE admin_users ADD COLUMN ${name} ${type}`).run(); }
      catch (err) { if (!/duplicate column/i.test(String(err))) throw err; }
    }
  }
  await ensureSecuritySchema(db);
  schemaReady = true;
}

/** The Set-Cookie value for a new session (see createSession in adminSecurity.js). */
export async function sessionCookie(env, sessionId) {
  const payload = `v2.${sessionId}`;
  const signature = await sign(payload, key(env));
  return `${COOKIE_NAME}=${payload}.${signature}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${12 * 3600}`;
}

/** The session id in the cookie (signature checked), or null. Older cookies are no longer accepted. */
export async function cookieSessionId(request, env) {
  if (!env.ADMIN_CODE) return null;
  const match = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  const parts = match[1].split('.');
  if (parts.length !== 3 || parts[0] !== 'v2' || !/^[a-f0-9]{48}$/.test(parts[1])) return null;
  if (!(await verify(`v2.${parts[1]}`, parts[2], key(env)))) return null;
  return parts[1];
}

// Activity that keeps a session open: opening an admin page, saving something,
// or the "still here" signal admin pages send while someone is using them.
// Automatic refreshes in the background don't count.
function isActivity(request) {
  const url = new URL(request.url);
  if (request.method === 'GET') return url.pathname.startsWith('/admin');
  return !/^\/api\/admin\/(fan-alerts\/run|notifications)(\/|$)/.test(url.pathname);
}

const memo = new WeakMap();
/**
 * The signed-in admin ({id, name, email, role, canExport, twoStep, sessionId,
 * restrict, twoStepDue}) or null. restrict = 'password' (must choose a new
 * password first) or 'twostep' (must set up two-step login first).
 */
export async function getAdmin(request, env) {
  if (!env.ADMIN_CODE) return null;
  if (memo.has(request)) return memo.get(request);
  const p = findAdmin(request, env);
  memo.set(request, p);
  return p;
}
async function findAdmin(request, env) {
  // The owner's code in a header: for scripts and tests (the browser uses the session cookie).
  const code = request.headers.get('x-admin-code') || '';
  if (code && code.length === env.ADMIN_CODE.length && code === env.ADMIN_CODE) {
    // The old emergency admin code stops working once the Super Admins switch it off.
    await ensureAdminSchema(env.DB);
    if ((await securitySettings(env.DB)).admin_code_off === '1') return null;
    return { ...OWNER };
  }

  const sid = await cookieSessionId(request, env);
  if (!sid) return null;
  await ensureAdminSchema(env.DB);
  const s = await liveSession(env.DB, sid);
  if (!s) return null;
  if (isActivity(request)) await touchSession(env.DB, s);
  // A matchday helper (gate or kitchen, one match day only).
  if (helperId(s.user_id)) return helperAdmin(env.DB, helperId(s.user_id), sid);
  if (s.user_id === 'owner') {
    if ((await securitySettings(env.DB)).admin_code_off === '1') return null;
    return { ...OWNER, sessionId: sid };
  }

  const u = await env.DB.prepare(`SELECT id, name, email, role, can_export_fan_data, active, totp_enabled, must_change_password, twostep_grace_until, created_at, password_hash, test_account, gmail_notice_at, access_until FROM admin_users WHERE id = ?`).bind(s.user_id).first();
  if (!u || !u.active) return null;
  // Contractor (temporary) access: nothing after the end date.
  if (u.access_until && Date.now() > u.access_until) return null;
  const settings = await securitySettings(env.DB);
  if (allowlistApplies(settings, roleOf(u)) && !ipAllowed(clientIp(request), settings.ip_allowlist)) return null;
  // Super Admin only for the three people on the list (otherwise: Head of Media rights).
  const full = isFullSuperAdmin(env, u);
  const role = u.role === 'super_admin' && !full ? 'head_of_media' : u.role;
  const admin = { id: u.id, name: u.name, email: u.email, role, canExport: !!u.can_export_fan_data, twoStep: !!u.totp_enabled, sessionId: sid };
  if (u.access_until) admin.accessUntil = new Date(u.access_until).toISOString();
  if (u.role === 'super_admin' && !full) admin.superAdminBlocked = true;
  // The one-time notice for Super Admins who sign in with a Gmail address.
  if (full && /@gmail\.com$/i.test(u.email) && !u.gmail_notice_at) admin.gmailNotice = true;
  if (u.must_change_password) admin.restrict = 'password';
  // Super Admins must set up two-step login before anything else (no 7 days' grace).
  else if (full && !u.totp_enabled && !(env.STAFF_TEST_PASSWORDS === '1' && u.test_account)) admin.restrict = 'twostep';
  if (!admin.restrict && settings.require_two_step === '1' && !u.totp_enabled) {
    const due = twoStepDeadline(u, settings);
    if (Date.now() > due) admin.restrict = 'twostep';
    else admin.twoStepDue = new Date(due).toISOString();
  }
  return admin;
}

/** When someone without two-step login must have it set up (7 days after it became required, or after their account was made). */
export function twoStepDeadline(u, settings) {
  if (u.twostep_grace_until) return u.twostep_grace_until;
  const since = Number(settings.two_step_since) || Date.now();
  const made = Date.parse(String(u.created_at || '').replace(' ', 'T') + (String(u.created_at || '').includes('Z') ? '' : 'Z')) || 0;
  return Math.max(since, made) + GRACE_DAYS * 86400e3;
}

/** Used by the /admin page middleware. */
export async function hasAdminSession(request, env) {
  return !!(await getAdmin(request, env));
}

/** One Activity Log entry (append-only; see activityLog.js). Some entries are also security alerts. */
export async function logAdminAction(db, admin, action, detail = '') {
  await ensureAdminSchema(db);
  await writeLog(db, admin, action, detail);
}

export function clearAdminCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
