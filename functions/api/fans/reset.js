import { hashPassword } from '../_lib/password.js';
import { ensureFanSchema, clientIp, rateLimit, tooMany, consumeToken } from '../_lib/fans.js';

// POST /api/fans/reset { token, password, confirmPassword } -- set a new
// password using the link from the reset email. Using the link also proves
// the fan owns the email address, so the account is marked verified.
export async function onRequestPost({ request, env }) {
  await ensureFanSchema(env.DB);
  if (!(await rateLimit(env.DB, `reset-ip:${clientIp(request)}`, 10, 3600))) return tooMany();

  let b;
  try { b = await request.json(); } catch { b = {}; }
  const password = typeof b.password === 'string' ? b.password : '';
  const errors = {};
  if (password.length < 8) errors.password = 'Password must be at least 8 characters.';
  else if (password.length > 200) errors.password = 'Password is too long.';
  if (!errors.password && password !== b.confirmPassword) errors.confirmPassword = 'The passwords do not match.';
  if (Object.keys(errors).length) return Response.json({ errors }, { status: 400 });

  const memberId = await consumeToken(env.DB, b.token, 'reset');
  if (!memberId) {
    return Response.json({ error: 'This reset link is invalid or has expired. Please request a new one.' }, { status: 400 });
  }
  await env.DB.prepare(
    `UPDATE members SET password_hash = ?, email_verified = 1,
       email_verified_at = COALESCE(email_verified_at, datetime('now')) WHERE id = ?`
  ).bind(await hashPassword(password), memberId).run();
  await env.DB.prepare(`DELETE FROM auth_tokens WHERE member_id = ? AND purpose = 'reset'`).bind(memberId).run();
  return Response.json({ ok: true });
}
