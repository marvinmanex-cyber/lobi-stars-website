import { verifyPassword } from '../_lib/password.js';
import { createSessionCookie, fanHintCookie } from '../_lib/session.js';
import { ensureFanSchema, clientIp, rateLimit, tooMany } from '../_lib/fans.js';

// POST /api/auth/login -- shared by fan accounts (/fans/login) and the
// membership page. Accounts must have confirmed their email address.
export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { email, password } = body || {};
  if (!email || !password) {
    return Response.json({ error: 'Please enter your email and password.' }, { status: 400 });
  }
  const normalized = String(email).trim().toLowerCase();

  await ensureFanSchema(env.DB);
  const ip = clientIp(request);
  if (!(await rateLimit(env.DB, `login-ip:${ip}`, 20, 900)) || !(await rateLimit(env.DB, `login:${normalized}`, 8, 900))) {
    return tooMany();
  }

  const member = await env.DB.prepare(`SELECT * FROM members WHERE email = ?`).bind(normalized).first();
  const valid = member && (await verifyPassword(password, member.password_hash));
  if (!valid) {
    // Same message whether the email doesn't exist or the password is wrong,
    // so login attempts can't be used to enumerate registered emails.
    return Response.json({ error: 'Incorrect email or password.' }, { status: 401 });
  }
  if (!member.email_verified) {
    return Response.json(
      { error: 'Please confirm your email address before logging in. Check your inbox for the confirmation link.', code: 'unverified' },
      { status: 403 }
    );
  }

  const cookie = await createSessionCookie(member.id, env.SESSION_SECRET);

  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.append('Set-Cookie', cookie);
  headers.append('Set-Cookie', fanHintCookie(true));
  return new Response(
    JSON.stringify({ member: { id: member.id, firstName: member.first_name, lastName: member.last_name, email: member.email } }),
    { status: 200, headers }
  );
}
