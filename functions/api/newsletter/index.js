import { captureContact, splitName } from '../_lib/contacts.js';
import { normalizeNigerianPhone, clientIp, rateLimit, tooMany, ensureFanSchema } from '../_lib/fans.js';
import { ensureNewsletterSchema } from '../_lib/newsletter.js';
import { earnNewsletter } from '../_lib/rewardsEarn.js';

// POST /api/newsletter { fullName, phone, email, confirmEmail, consent, source?, weekly?, matchday?, offers? }
// The options (weekly newsletter, matchday & ticket alerts, partner offers)
// default to the weekly newsletter only; the /newsletter page lets fans choose.
// Newsletter sign-up (separate from club membership), stored in
// newsletter_subscribers and merged into the fan database. Signing up again
// with the same email updates the details instead of failing.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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
    await ensureNewsletterSchema(env.DB);
    const pref = (v, d) => (typeof v === 'boolean' ? (v ? 1 : 0) : d);
    const weekly = pref(b.weekly, 1), matchday = pref(b.matchday, 0), offers = pref(b.offers, 0);
    const now = new Date().toISOString();
    const existing = await env.DB.prepare(`SELECT email FROM newsletter_subscribers WHERE email = ?`).bind(email).first();
    if (existing) {
      await env.DB.prepare(
        `UPDATE newsletter_subscribers SET full_name = ?, phone_e164 = ?, consent_at = ?, updated_at = ?,
           pref_weekly = CASE WHEN ? THEN ? ELSE pref_weekly END, pref_matchday = CASE WHEN ? THEN ? ELSE pref_matchday END, pref_offers = CASE WHEN ? THEN ? ELSE pref_offers END
         WHERE email = ?`
      ).bind(fullName, phone, now, now, typeof b.weekly === 'boolean' ? 1 : 0, weekly, typeof b.matchday === 'boolean' ? 1 : 0, matchday, typeof b.offers === 'boolean' ? 1 : 0, offers, email).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO newsletter_subscribers (email, source, full_name, phone_e164, consent_at, updated_at, pref_weekly, pref_matchday, pref_offers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(email, source, fullName, phone, now, now, weekly, matchday, offers).run();
    }
    const n = splitName(fullName);
    await captureContact(env, {
      // A re-subscribe with new details is a new interaction, so the latest name/phone reach the fan database.
      source: 'newsletter', refTable: 'newsletter_subscribers', refId: existing ? `${email}#${now}` : email,
      email, phone, firstName: n.firstName, surname: n.surname, consent: true, label: source,
    });
    await earnNewsletter(env, email); // Lobi Stars Rewards: once, for the fan account with this email
    return Response.json({
      ok: true, updated: !!existing,
      message: existing ? "You're already subscribed – details updated." : "You're subscribed! Watch your inbox for club news.",
    });
  } catch {
    return Response.json({ error: 'Sign-up is temporarily unavailable. Please try again later.' }, { status: 500 });
  }
}
