// "Sign in with your email, no password needed": a 6-digit code emailed to
// the fan. It signs them into their normal fan account (members), creating
// one if this email is new, so one login works for the Match Day Programme,
// Man of the Match and Predict & Win.
//
// Codes are stored hashed (SHA-256 of secret:email:code), expire after 10
// minutes, allow 5 tries and are rate limited per email and per IP (the IP is
// stored only as a hash).
import { ensureFanSchema, EMAIL_RE, normalizeNigerianPhone, clientIp } from './fans.js';
import { createSessionCookie, readSession, fanHintCookie } from './session.js';
import { ensureProgrammeSchema, programmeSettings } from './programme.js';
import { captureContact } from './contacts.js';
import { sendEmail } from './email.js';
import { randomId } from './crypto.js';

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const BAD_CODE = "That code didn't work. Check it or request a new one.";

export function normaliseEmail(input) {
  const e = typeof input === 'string' ? input.trim().toLowerCase() : '';
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

/** 6 digits, uniform (rejection sampling, no modulo bias). */
export function generateCode() {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / 1000000) * 1000000;
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return String(buf[0] % 1000000).padStart(6, '0');
  }
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export const hashCode = (email, code, secret) => sha256Hex(`${secret}:${email}:${code}`);
export const hashIp = (ip, secret) => sha256Hex(`ip:${secret}:${ip}`).then(h => h.slice(0, 32));

export function timingSafeEqual(a, b) {
  const x = String(a), y = String(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

/** POSTs must come from this site (blocks cross-site form posts). Returns a 403 Response or null. */
export function checkOrigin(request) {
  const origin = request.headers.get('Origin');
  if (origin && origin === new URL(request.url).origin) return null;
  return Response.json({ error: 'Forbidden' }, { status: 403 });
}

/**
 * What we already know about this email from earlier sign-ups (fan database
 * and newsletter): { firstName, lastName, phone, marketingConsent, source } or null.
 */
export async function findExistingFan(db, email) {
  try {
    const c = await db.prepare(`SELECT first_name, surname, phone, marketing_consent, unsubscribed_at, first_source FROM contacts WHERE email = ?`).bind(email).first();
    const n = await db.prepare(`SELECT full_name, phone_e164, consent_at FROM newsletter_subscribers WHERE email = ?`).bind(email).first().catch(() => null);
    if (!c && !n) return null;
    const [nFirst, ...nRest] = String(n?.full_name || '').trim().split(/\s+/);
    return {
      firstName: c?.first_name || nFirst || '',
      lastName: c?.surname || nRest.join(' ') || '',
      phone: c?.phone || n?.phone_e164 || null,
      marketingConsent: !!((c?.marketing_consent && !c?.unsubscribed_at) || n?.consent_at),
      source: c?.first_source || (n ? 'newsletter' : null),
    };
  } catch (err) {
    console.error('[fan code] existing lookup', err);
    return null;
  }
}

export async function sendLoginCode(env, request, email, code) {
  const local = /^(localhost|127\.0\.0\.1)$/.test(new URL(request.url).hostname);
  if (!env.RESEND_API_KEY) {
    if (local) { console.log(`[fan code] ${email}: ${code}`); return; }
    throw new Error('RESEND_API_KEY is not set');
  }
  const html = `<!doctype html><html><body style="margin:0;background:#F4F5F7;font-family:Arial,Helvetica,sans-serif;color:#15181D">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" style="max-width:480px;background:#fff;border-radius:14px;overflow:hidden" cellpadding="0" cellspacing="0">
<tr><td style="background:#15181D;padding:18px 24px;color:#fff;font-weight:bold;font-size:18px;letter-spacing:1px">LOBI STARS FC</td></tr>
<tr><td style="padding:26px 24px">
<p style="margin:0 0 14px;font-size:16px">Your sign-in code is:</p>
<p style="margin:0 0 18px;font-size:34px;font-weight:bold;letter-spacing:8px;color:#E31E24">${code}</p>
<p style="margin:0 0 10px;font-size:15px">It expires in 10 minutes.</p>
<p style="margin:0;font-size:14px;color:#5B6472">If you didn't ask for this, ignore this email.</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `Your Lobi Stars FC sign-in code is: ${code}\n\nIt expires in 10 minutes.\n\nIf you didn't ask for this, ignore this email.`;
  await sendEmail(env, {
    from: 'Lobi Stars FC <noreply@lobistarsfc.com>', replyTo: 'info@lobistarsfc.com', to: email,
    subject: `Your Lobi Stars FC code: ${code}`, html, text,
  });
}

/**
 * Now and then (about 1 in 50 requests): deletes old codes, and makes reading
 * activity older than 2 years anonymous (as the Privacy Policy says).
 */
export async function maybeCleanup(db) {
  if (Math.random() > 0.02) return;
  try {
    await db.batch([
      db.prepare(`DELETE FROM fan_login_codes WHERE created_at < datetime('now', '-2 days')`),
      db.prepare(`UPDATE programme_events SET fan_id = NULL WHERE fan_id IS NOT NULL AND created_at < datetime('now', '-2 years')`),
    ]);
  } catch (err) { console.error('[fan code] cleanup', err); }
}

/** Creates and emails a code. Returns { ok } or { error, status } (rate limits). */
export async function requestCode(env, request, waitUntil, email) {
  const db = env.DB;
  await ensureProgrammeSchema(db);
  const ipHash = await hashIp(clientIp(request), env.SESSION_SECRET || '');
  const [byEmail, byIp] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM fan_login_codes WHERE email = ? AND created_at > datetime('now', '-15 minutes')`).bind(email),
    db.prepare(`SELECT COUNT(*) AS n FROM fan_login_codes WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')`).bind(ipHash),
  ]);
  if (byEmail.results[0].n >= 3) return { status: 429, error: 'We have sent a few codes to this email already. Please wait 15 minutes, then try again.' };
  if (byIp.results[0].n >= 10) return { status: 429, error: 'Too many codes requested from this connection. Please try again in an hour.' };
  const code = generateCode();
  await db.prepare(`INSERT INTO fan_login_codes (email, code_hash, expires_at, ip_hash) VALUES (?, ?, ?, ?)`)
    .bind(email, await hashCode(email, code, env.SESSION_SECRET || ''), new Date(Date.now() + CODE_TTL_MS).toISOString(), ipHash).run();
  const send = sendLoginCode(env, request, email, code).catch(err => console.error('[fan code] email failed', err));
  if (waitUntil) waitUntil(send); else await send;
  await maybeCleanup(db);
  return { ok: true, devCode: String(env.FANS_DEV_LINKS) === '1' ? code : undefined };
}

/**
 * Checks a code; on success signs the fan in (creating the account if new).
 * Returns { ok, member, needsProfile, cookies } or { error, status }.
 */
export async function verifyCode(env, email, code, { programmeId = null } = {}) {
  const db = env.DB;
  await ensureProgrammeSchema(db);
  await ensureFanSchema(db);
  const now = new Date().toISOString();
  const row = await db.prepare(`SELECT * FROM fan_login_codes WHERE email = ? AND used_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1`).bind(email, now).first();
  if (!row) return { status: 400, error: BAD_CODE };
  const attempts = row.attempts + 1;
  const good = /^\d{6}$/.test(code) && timingSafeEqual(await hashCode(email, code, env.SESSION_SECRET || ''), row.code_hash);
  if (!good) {
    await db.prepare(`UPDATE fan_login_codes SET attempts = ?, used_at = CASE WHEN ? >= ? THEN ? ELSE used_at END WHERE id = ?`)
      .bind(attempts, attempts, MAX_ATTEMPTS, now, row.id).run();
    return { status: 400, error: BAD_CODE };
  }
  const claimed = await db.prepare(`UPDATE fan_login_codes SET attempts = ?, used_at = ? WHERE id = ? AND used_at IS NULL`).bind(attempts, now, row.id).run();
  if (!claimed.meta?.changes) return { status: 400, error: BAD_CODE };

  let member = await db.prepare(`SELECT * FROM members WHERE email = ?`).bind(email).first();
  let created = false;
  if (!member) {
    const known = await findExistingFan(db, email);
    let phone = normalizeNigerianPhone(known?.phone);
    if (phone && await db.prepare(`SELECT 1 FROM members WHERE phone_e164 = ?`).bind(phone).first()) phone = null;
    const id = randomId('LS-MBR', 6);
    try {
      // No password: "!" can never match a password (they can set one with Forgot password).
      await db.prepare(`INSERT INTO members (id, first_name, last_name, email, phone, tier, password_hash, email_verified, email_verified_at,
          phone_e164, marketing_opt_in, marketing_consent_at, first_programme, last_login_at, profile_completed_at)
        VALUES (?, ?, ?, ?, ?, 'Fan', '!', 1, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, known?.firstName || '', known?.lastName || '', email, phone, now, phone,
          known?.marketingConsent ? 1 : 0, known?.marketingConsent ? now : null, programmeId ? String(programmeId) : null, now,
          known?.firstName ? now : null).run();
      created = true;
    } catch (err) {
      console.error('[fan code] create account', err);
    }
    member = await db.prepare(`SELECT * FROM members WHERE email = ?`).bind(email).first();
    if (!member) return { status: 500, error: 'Something went wrong. Please try again.' };
  } else {
    await db.prepare(`UPDATE members SET email_verified = 1, email_verified_at = COALESCE(email_verified_at, ?), last_login_at = ?,
        profile_completed_at = CASE WHEN profile_completed_at IS NULL AND first_name != '' THEN ? ELSE profile_completed_at END WHERE id = ?`)
      .bind(now, now, now, member.id).run();
  }
  await captureContact(env, { source: 'programme', refTable: 'members', refId: member.id, email, phone: member.phone_e164,
    firstName: member.first_name, surname: member.last_name, consent: !!member.marketing_opt_in && created });
  const days = (await programmeSettings(db)).sessionDays;
  return {
    ok: true, created, member,
    needsProfile: !String(member.first_name || '').trim(),
    cookies: [await createSessionCookie(member.id, env.SESSION_SECRET, days), fanHintCookie(true)],
  };
}

/** The signed-in fan (members row) or null. Never throws. */
export async function getFan(request, env) {
  try {
    const id = await readSession(request, env.SESSION_SECRET);
    if (!id) return null;
    await ensureFanSchema(env.DB);
    const m = await env.DB.prepare(`SELECT id, first_name, last_name, email, email_verified FROM members WHERE id = ?`).bind(id).first();
    return m && m.email_verified ? m : null;
  } catch (err) {
    console.error('[fan] session', err);
    return null;
  }
}

/** { fan } or { denied: Response } (401 signin_required, 403 profile_required). */
export async function requireFan(request, env) {
  const fan = await getFan(request, env);
  if (!fan) return { denied: Response.json({ error: 'signin_required' }, { status: 401, headers: { 'Cache-Control': 'no-store' } }) };
  if (!String(fan.first_name || '').trim()) return { denied: Response.json({ error: 'profile_required' }, { status: 403, headers: { 'Cache-Control': 'no-store' } }) };
  return { fan };
}

export function jsonWithCookies(data, cookies = [], status = 200) {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify(data), { status, headers });
}
