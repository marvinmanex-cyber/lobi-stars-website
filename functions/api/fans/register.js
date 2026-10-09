import { randomId } from '../_lib/crypto.js';
import { hashPassword } from '../_lib/password.js';
import {
  ensureFanSchema, EMAIL_RE, normalizeNigerianPhone, safeNext, clientIp, rateLimit, tooMany,
  checkTurnstile, createToken, sendVerificationEmail, VERIFY_TTL_MS,
} from '../_lib/fans.js';

// POST /api/fans/register -- create a fan account and email a confirmation
// link. Returns { errors: { field: message } } (400) when validation fails.
export async function onRequestPost({ request, env }) {
  await ensureFanSchema(env.DB);
  const ip = clientIp(request);
  if (!(await rateLimit(env.DB, `register:${ip}`, 5, 3600))) return tooMany();

  let b;
  try { b = await request.json(); } catch { return Response.json({ error: 'Invalid request.' }, { status: 400 }); }
  const str = v => (typeof v === 'string' ? v.trim() : '');
  const firstName = str(b.firstName).slice(0, 60);
  const surname = str(b.surname).slice(0, 60);
  const email = str(b.email).toLowerCase();
  const confirmEmail = str(b.confirmEmail).toLowerCase();
  const phone = normalizeNigerianPhone(b.phone);
  const password = typeof b.password === 'string' ? b.password : '';
  const confirmPassword = typeof b.confirmPassword === 'string' ? b.confirmPassword : '';

  const errors = {};
  if (!firstName) errors.firstName = 'Please enter your first name.';
  if (!surname) errors.surname = 'Please enter your surname.';
  if (!EMAIL_RE.test(email) || email.length > 254) errors.email = 'Please enter a valid email address.';
  if (!errors.email && email !== confirmEmail) errors.confirmEmail = 'The email addresses do not match.';
  if (!phone) errors.phone = 'Please enter a valid Nigerian mobile number, e.g. 0803 123 4567 or +234 803 123 4567.';
  if (password.length < 8) errors.password = 'Password must be at least 8 characters.';
  else if (password.length > 200) errors.password = 'Password is too long.';
  if (!errors.password && password !== confirmPassword) errors.confirmPassword = 'The passwords do not match.';
  if (b.agree !== true) errors.agree = 'Please confirm you are 18 or older and agree to the Terms & Conditions and Privacy Policy.';

  if (!(await checkTurnstile(env, b.turnstileToken, ip))) errors.human = 'Please complete the human check and try again.';

  if (!errors.email) {
    const taken = await env.DB.prepare(`SELECT id FROM members WHERE email = ?`).bind(email).first();
    if (taken) errors.email = 'An account with this email already exists. Try logging in, or reset your password.';
  }
  if (!errors.phone) {
    const taken = await env.DB.prepare(`SELECT id FROM members WHERE phone_e164 = ?`).bind(phone).first();
    if (taken) errors.phone = 'This phone number is already linked to an account.';
  }
  if (Object.keys(errors).length) return Response.json({ errors }, { status: 400 });

  const id = randomId('LS-MBR', 6);
  try {
    await env.DB.prepare(
      `INSERT INTO members (id, first_name, last_name, email, phone, tier, password_hash,
                            email_verified, phone_e164, marketing_opt_in, age_confirmed_at)
       VALUES (?, ?, ?, ?, ?, 'Fan', ?, 0, ?, ?, datetime('now'))`
    ).bind(id, firstName, surname, email, phone, await hashPassword(password), phone, b.marketing === true ? 1 : 0).run();
  } catch (err) {
    // Unique constraint race (same email/phone submitted twice at once).
    return Response.json({ errors: { email: 'An account with this email or phone already exists.' } }, { status: 400 });
  }

  const token = await createToken(env.DB, id, 'verify', VERIFY_TTL_MS);
  try {
    const devLink = await sendVerificationEmail(env, new URL(request.url).origin, { first_name: firstName, email }, token, safeNext(b.next));
    return Response.json(devLink ? { ok: true, devLink } : { ok: true });
  } catch (err) {
    console.error('[fans] verification email failed', err);
    return Response.json({ ok: true, emailFailed: true });
  }
}
