import { verifyPassword } from '../_lib/password.js';
import { createSessionCookie } from '../_lib/session.js';

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

  const member = await env.DB.prepare(`SELECT * FROM members WHERE email = ?`).bind(email.toLowerCase()).first();
  const valid = member && (await verifyPassword(password, member.password_hash));
  if (!valid) {
    // Same message whether the email doesn't exist or the password is wrong,
    // so login attempts can't be used to enumerate registered emails.
    return Response.json({ error: 'Incorrect email or password.' }, { status: 401 });
  }

  const cookie = await createSessionCookie(member.id, env.SESSION_SECRET);

  return new Response(
    JSON.stringify({ member: { id: member.id, firstName: member.first_name, lastName: member.last_name, email: member.email } }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie } }
  );
}
