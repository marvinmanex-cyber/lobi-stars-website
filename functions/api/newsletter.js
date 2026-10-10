import { captureContact, splitName } from './_lib/contacts.js';
import { normalizeNigerianPhone, clientIp, rateLimit, tooMany, ensureFanSchema } from './_lib/fans.js';

// POST /api/newsletter { fullName, phone, email, confirmEmail, consent, source? }
// Newsletter sign-up (separate from club membership), stored in
// newsletter_subscribers and merged into the fan database. Signing up again
// with the same email updates the details instead of failing.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

let ready = false;
async function ensureTable(db) {
  if (ready) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS newsletter_subscribers (
       email TEXT PRIMARY KEY,
       source TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`
  ).run();
  const cols = new Set((await db.prepare(`PRAGMA table_info(newsletter_subscribers)`).all()).results.map(r => r.name));
  for (const [name, type] of [['full_name', 'TEXT'], ['phone_e164', 'TEXT'], ['consent_at', 'TEXT'], ['updated_at', 'TEXT']]) {
    if (!cols.has(name)) await db.prepare(`ALTER TABLE newsletter_subscribers ADD COLUMN ${name} ${type}`).run();
  }
  ready = true;
}

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch { b = {}; }
  const str = (v, n) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, n) : '');
  const email = str(b.email, 254).toLowerCase();
  const confirm = str(b.confirmEmail, 254).toLowerCase();
  const fullName = str(b.fullName, 100);
  const source = str(b.source, 100);
  const errors = {};

  if (!fullName) errors.fullName = 'Please enter your full name.';
  if (!EMAIL_RE.test(email)) errors.email = 'Please enter a valid email address.';
  else if (email !== confirm) errors.confirmEmail = 'The email addresses do not match.';
  const phone = normalizeNigerianPhone(b.phone);
  if (!phone) errors.phone = 'Please enter a Nigerian mobile number, e.g. 0803 123 4567.';
  if (b.consent !== true) errors.consent = 'Please tick the box to agree to receive club news.';
  if (Object.keys(errors).length) return Response.json({ errors, error: Object.values(errors)[0] }, { status: 400 });

  try {
    await ensureFanSchema(env.DB);
    if (!(await rateLimit(env.DB, `newsletter:${clientIp(request)}`, 20, 3600))) return tooMany();
    await ensureTable(env.DB);
    const now = new Date().toISOString();
    const existing = await env.DB.prepare(`SELECT email FROM newsletter_subscribers WHERE email = ?`).bind(email).first();
    if (existing) {
      await env.DB.prepare(
        `UPDATE newsletter_subscribers SET full_name = ?, phone_e164 = ?, consent_at = ?, updated_at = ? WHERE email = ?`
      ).bind(fullName, phone, now, now, email).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO newsletter_subscribers (email, source, full_name, phone_e164, consent_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(email, source, fullName, phone, now, now).run();
    }
    const n = splitName(fullName);
    await captureContact(env, {
      // A re-subscribe with new details is a new interaction, so the latest name/phone reach the fan database.
      source: 'newsletter', refTable: 'newsletter_subscribers', refId: existing ? `${email}#${now}` : email,
      email, phone, firstName: n.firstName, surname: n.surname, consent: true, label: source,
    });
    return Response.json({
      ok: true, updated: !!existing,
      message: existing ? "You're already subscribed – details updated." : "You're subscribed! Watch your inbox for club news.",
    });
  } catch {
    return Response.json({ error: 'Sign-up is temporarily unavailable. Please try again later.' }, { status: 500 });
  }
}
