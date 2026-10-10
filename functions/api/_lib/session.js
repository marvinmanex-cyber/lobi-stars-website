import { sign, verify } from './crypto.js';

// Stateless signed session cookie: "memberId.expiryMs.signature". No
// sessions table -- logout just clears the cookie client-side rather than
// revoking server-side, which is an acceptable tradeoff for a fan
// membership site (not a banking app). Sessions last 30 days.
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = 'ls_session';

export async function createSessionCookie(memberId, secret) {
  const expiry = Date.now() + SESSION_DURATION_MS;
  const payload = `${memberId}.${expiry}`;
  const signature = await sign(payload, secret);
  const token = encodeURIComponent(`${payload}.${signature}`);
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_DURATION_MS / 1000)}`;
}

export async function readSession(request, secret) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;

  const token = decodeURIComponent(match[1]);
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [memberId, expiryStr, signature] = parts;
  const expiry = Number.parseInt(expiryStr, 10);
  if (!memberId || !expiry || Date.now() > expiry) return null;

  const valid = await verify(`${memberId}.${expiry}`, signature, secret);
  return valid ? memberId : null;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

/**
 * Non-secret hint cookie ("ls_fan=1") readable by page scripts, so the header
 * knows to show the fan's initials without calling the server on every page.
 * It grants nothing: the real session is the HttpOnly ls_session cookie.
 */
export function fanHintCookie(on) {
  return on
    ? `ls_fan=1; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_DURATION_MS / 1000)}`
    : 'ls_fan=; Secure; SameSite=Lax; Path=/; Max-Age=0';
}
