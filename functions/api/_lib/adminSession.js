import { sign, verify } from './crypto.js';

// Signed staff cookie set by /api/admin/login once the ADMIN_CODE has been
// checked. It gates the /admin pages themselves (functions/admin/_middleware.js);
// the admin APIs still require the x-admin-code header as before. The signing
// key includes ADMIN_CODE, so changing the code logs every device out.
const COOKIE_NAME = 'ls_admin';
const DURATION_MS = 12 * 60 * 60 * 1000;

function key(env) {
  return `${env.SESSION_SECRET || ''}|admin|${env.ADMIN_CODE}`;
}

export async function createAdminCookie(env) {
  const expiry = Date.now() + DURATION_MS;
  const payload = `admin.${expiry}`;
  const signature = await sign(payload, key(env));
  return `${COOKIE_NAME}=${payload}.${signature}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${DURATION_MS / 1000}`;
}

export async function hasAdminSession(request, env) {
  if (!env.ADMIN_CODE) return false;
  const match = (request.headers.get('Cookie') || '').match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return false;
  const [who, expiryStr, signature] = match[1].split('.');
  const expiry = Number.parseInt(expiryStr, 10);
  if (who !== 'admin' || !expiry || !signature || Date.now() > expiry) return false;
  return verify(`admin.${expiry}`, signature, key(env));
}

export function clearAdminCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
