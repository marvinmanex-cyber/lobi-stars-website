import { sign, verify } from './crypto.js';

// Staff (admin) sign-in.
//
// - The OWNER signs in with the shared ADMIN_CODE secret and has every
//   permission, including managing staff accounts.
// - STAFF sign in with their own email + password (admin_users table). Each
//   account has a can_export_fan_data permission.
//
// A signed cookie ("ls_admin") records who is signed in. It gates the
// /admin pages (functions/admin/_middleware.js) and the admin APIs. The
// signing key includes ADMIN_CODE, so changing the code signs everyone out.
const COOKIE_NAME = 'ls_admin';
const DURATION_MS = 12 * 60 * 60 * 1000;
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
  schemaReady = true;
}

export async function createAdminCookie(env, userId = 'owner') {
  const expiry = Date.now() + DURATION_MS;
  const payload = `${userId}.${expiry}`;
  const signature = await sign(payload, key(env));
  return `${COOKIE_NAME}=${payload}.${signature}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${DURATION_MS / 1000}`;
}

async function cookieUserId(request, env) {
  if (!env.ADMIN_CODE) return null;
  const match = (request.headers.get('Cookie') || '').match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  const parts = match[1].split('.');
  if (parts.length !== 3) return null;
  // Older cookies said "admin" for the owner.
  const [rawId, expiryStr, signature] = parts;
  const expiry = Number.parseInt(expiryStr, 10);
  if (!rawId || !expiry || !signature || Date.now() > expiry) return null;
  if (!(await verify(`${rawId}.${expiry}`, signature, key(env)))) return null;
  return rawId === 'admin' ? 'owner' : rawId;
}

/** The signed-in admin ({id, name, email, role, canExport}) or null. */
export async function getAdmin(request, env) {
  if (!env.ADMIN_CODE) return null;
  const code = request.headers.get('x-admin-code') || '';
  if (code && code.length === env.ADMIN_CODE.length && code === env.ADMIN_CODE) return OWNER;

  const id = await cookieUserId(request, env);
  if (!id) return null;
  if (id === 'owner') return OWNER;
  await ensureAdminSchema(env.DB);
  const u = await env.DB.prepare(`SELECT id, name, email, role, can_export_fan_data, active FROM admin_users WHERE id = ?`).bind(id).first();
  if (!u || !u.active) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role, canExport: !!u.can_export_fan_data };
}

/** Used by the /admin page middleware. */
export async function hasAdminSession(request, env) {
  return !!(await getAdmin(request, env));
}

export async function logAdminAction(db, admin, action, detail = '') {
  await ensureAdminSchema(db);
  await db.prepare(`INSERT INTO admin_log (staff_id, staff_name, action, detail) VALUES (?, ?, ?, ?)`)
    .bind(admin.id, admin.name, action, String(detail).slice(0, 500)).run();
}

export function clearAdminCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
