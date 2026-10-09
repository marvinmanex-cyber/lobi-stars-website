import { ensureFanSchema, EMAIL_RE, clientIp, rateLimit, tooMany, createToken, sendResetEmail, RESET_TTL_MS } from '../_lib/fans.js';

// POST /api/fans/forgot { email } -- email a password-reset link. Always
// answers the same way so it can't be used to find out who has an account.
export async function onRequestPost({ request, env }) {
  await ensureFanSchema(env.DB);
  let b;
  try { b = await request.json(); } catch { b = {}; }
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) return Response.json({ error: 'Please enter a valid email address.' }, { status: 400 });

  const ip = clientIp(request);
  if (!(await rateLimit(env.DB, `forgot-ip:${ip}`, 10, 3600)) || !(await rateLimit(env.DB, `forgot:${email}`, 3, 3600))) return tooMany();

  const member = await env.DB.prepare(`SELECT id, first_name, email FROM members WHERE email = ?`).bind(email).first();
  let devLink = null;
  if (member) {
    const token = await createToken(env.DB, member.id, 'reset', RESET_TTL_MS);
    try {
      devLink = await sendResetEmail(env, new URL(request.url).origin, member, token);
    } catch (err) {
      console.error('[fans] reset email failed', err);
    }
  }
  return Response.json(devLink ? { ok: true, devLink } : { ok: true });
}
