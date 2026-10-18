import { sessionCookie, logAdminAction } from '../_lib/adminSession.js';
import { createSession, deviceIdFrom, deviceCookie, randomHex } from '../_lib/adminSecurity.js';
import { clientIp, rateLimit, tooMany, ensureFanSchema } from '../_lib/fans.js';
import { helperLogin, HELPER_ROLES } from '../_lib/helpers.js';

// POST /api/helper/login { username, pin } or { token } -- a matchday helper signs in
// on their phone or tablet. The session lasts until their account finishes (23:59 on
// match day, or the end time set), with no idle timeout. Answers where to go next.
export async function onRequestPost({ request, env }) {
  const db = env.DB;
  await ensureFanSchema(db);
  if (!(await rateLimit(db, `helper-login:${clientIp(request)}`, 20, 900))) return tooMany();
  const b = await request.json().catch(() => ({}));
  const r = await helperLogin(env, { username: b.username, pin: b.pin, token: b.token });
  if (r.error) return Response.json({ error: r.error }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  const h = r.helper;
  const known = deviceIdFrom(request);
  const deviceId = known || randomHex(16);
  const sid = await createSession(db, request, `helper:${h.id}`, { deviceId, expiresAt: h.expires_at });
  await logAdminAction(db, { id: `helper:${h.id}`, name: `${h.name} (${HELPER_ROLES[h.kind].label})` }, 'helper_login', `${b.token ? 'login link' : 'username and PIN'}, ${clientIp(request)}`);
  const res = Response.json({ ok: true, name: h.name, kind: h.kind, screen: HELPER_ROLES[h.kind].screen, until: new Date(h.expires_at).toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
  res.headers.append('Set-Cookie', (await sessionCookie(env, sid)).replace(/Max-Age=\d+/, `Max-Age=${Math.max(60, Math.round((h.expires_at - Date.now()) / 1000))}`));
  if (!known) res.headers.append('Set-Cookie', deviceCookie(deviceId));
  return res;
}
