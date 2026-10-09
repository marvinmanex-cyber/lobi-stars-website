import { randomId } from '../_lib/crypto.js';
import { hashPassword } from '../_lib/password.js';
import {
  ensureFanSchema, EMAIL_RE, normalizeNigerianPhone, clientIp, rateLimit, tooMany,
  createToken, sendVerificationEmail, VERIFY_TTL_MS,
} from '../_lib/fans.js';

// POST /api/auth/signup -- membership sign-up from the /membership page.
// Creates the same kind of account as fan registration and, like it, needs
// the email address confirming before the member can log in.
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
  if (!EMAIL_RE.test(email)) {
    return Response.json({ error: 'Invalid email address' }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }

  await ensureFanSchema(env.DB);
  if (!(await rateLimit(env.DB, `register:${clientIp(request)}`, 5, 3600))) return tooMany();

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await env.DB.prepare(`SELECT id FROM members WHERE email = ?`).bind(normalizedEmail).first();
  if (existing) {
    return Response.json({ error: 'An account with this email already exists -- try logging in instead.' }, { status: 409 });
  }
  const phoneE164 = phone ? normalizeNigerianPhone(phone) : null;
  if (phoneE164) {
    const taken = await env.DB.prepare(`SELECT id FROM members WHERE phone_e164 = ?`).bind(phoneE164).first();
    if (taken) return Response.json({ error: 'This phone number is already linked to an account.' }, { status: 409 });
  }

  const memberId = randomId('LS-MBR', 6);
  const passwordHash = await hashPassword(password);

  await env.DB.prepare(
    `INSERT INTO members (id, first_name, last_name, email, phone, state, password_hash, email_verified, phone_e164)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).bind(memberId, firstName, lastName, normalizedEmail, phone || null, state || null, passwordHash, phoneE164).run();

  const token = await createToken(env.DB, memberId, 'verify', VERIFY_TTL_MS);
  try {
    await sendVerificationEmail(env, new URL(request.url).origin, { first_name: firstName, email: normalizedEmail }, token, '/membership');
  } catch (err) {
    console.error('[membership] verification email failed', err);
  }

  return Response.json({ member: { id: memberId, firstName, lastName, email: normalizedEmail }, needsVerification: true });
}
