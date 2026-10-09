import {
  ensureFanSchema, EMAIL_RE, safeNext, clientIp, rateLimit, tooMany,
  createToken, sendVerificationEmail, VERIFY_TTL_MS,
} from '../_lib/fans.js';

// POST /api/fans/resend { email } -- send a new confirmation link. Always
// answers the same way so it can't be used to find out who has an account.
export async function onRequestPost({ request, env }) {
  await ensureFanSchema(env.DB);
  let b;
  try { b = await request.json(); } catch { b = {}; }
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) return Response.json({ error: 'Please enter a valid email address.' }, { status: 400 });

  const ip = clientIp(request);
  if (!(await rateLimit(env.DB, `resend-ip:${ip}`, 10, 3600)) || !(await rateLimit(env.DB, `resend:${email}`, 3, 3600))) return tooMany();

  const member = await env.DB.prepare(`SELECT id, first_name, email, email_verified FROM members WHERE email = ?`).bind(email).first();
  if (member && !member.email_verified) {
    const token = await createToken(env.DB, member.id, 'verify', VERIFY_TTL_MS);
    try {
      await sendVerificationEmail(env, new URL(request.url).origin, member, token, safeNext(b.next));
    } catch (err) {
      console.error('[fans] resend failed', err);
    }
  }
  return Response.json({ ok: true });
}
