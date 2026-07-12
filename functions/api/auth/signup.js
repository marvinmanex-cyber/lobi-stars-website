import { randomId } from '../_lib/crypto.js';
import { hashPassword } from '../_lib/password.js';
import { createSessionCookie } from '../_lib/session.js';

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { firstName, lastName, email, phone, state, password } = body || {};

  if (!firstName || !lastName || !email || !password) {
    return Response.json({ error: 'Please fill in your name, email, and password.' }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: 'Invalid email address' }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }

  const normalizedEmail = email.toLowerCase();
  const existing = await env.DB.prepare(`SELECT id FROM members WHERE email = ?`).bind(normalizedEmail).first();
  if (existing) {
    return Response.json({ error: 'An account with this email already exists -- try logging in instead.' }, { status: 409 });
  }

  const memberId = randomId('LS-MBR', 6);
  const passwordHash = await hashPassword(password);

  await env.DB.prepare(
    `INSERT INTO members (id, first_name, last_name, email, phone, state, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(memberId, firstName, lastName, normalizedEmail, phone || null, state || null, passwordHash).run();

  const cookie = await createSessionCookie(memberId, env.SESSION_SECRET);

  return new Response(
    JSON.stringify({ member: { id: memberId, firstName, lastName, email: normalizedEmail } }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie } }
  );
}
