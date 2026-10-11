import { ensureContactsSchema, captureContact, normEmail, splitName } from './_lib/contacts.js';
import { clientIp, rateLimit, tooMany, ensureFanSchema, checkTurnstile } from './_lib/fans.js';
import { syncEnquiries, alertNewThread, maybeDailySummary } from './_lib/inbox.js';
import { randomId } from './_lib/crypto.js';

// POST /api/enquiry -- saves a Contact Us, partnership or hospitality enquiry
// to the database (the browser also still sends it to the club's Formspree
// inbox). Hospitality enquiries are stored as 'contact' rows (the table only
// allows contact/partnership) with "Hospitality: N guests" in `interest`,
// and appear in the fan database under the Hospitality Enquiry source.
// Every message also becomes an Inbox conversation (Fans & Inbox › Inbox).
//
// Spam protection: a hidden "_gotcha" field that people never see (bots fill
// it in; those messages are quietly dropped), the Turnstile human check when
// TURNSTILE_SECRET_KEY is set, and limits per connection and per email.
export async function onRequestPost({ request, env, waitUntil }) {
  await ensureFanSchema(env.DB);
  const ip = clientIp(request);
  if (!(await rateLimit(env.DB, `enquiry:${ip}`, 10, 3600))) return tooMany();
  let b;
  try { b = await request.json(); } catch { b = {}; }
  if (typeof b._gotcha === 'string' && b._gotcha.trim()) return Response.json({ ok: true });
  if (!(await checkTurnstile(env, b['cf-turnstile-response'] || b.turnstileToken, ip))) {
    return Response.json({ error: 'Please complete the human check and try again.' }, { status: 400 });
  }
  const s = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const kind = b.form === 'partnership' ? 'partnership' : b.form === 'hospitality' ? 'hospitality' : 'contact';
  if (kind === 'hospitality') {
    const guests = Math.max(0, Math.min(500, Math.round(Number(b.guests) || 0)));
    b.interest = guests ? `Hospitality: ${guests} guest${guests === 1 ? '' : 's'}` : 'Hospitality';
  }
  const email = normEmail(b.email);
  if (!email) return Response.json({ error: 'Please enter a valid email address.' }, { status: 400 });

  if (!(await rateLimit(env.DB, `enquiry-email:${email}`, 5, 3600))) return tooMany();

  const name = kind === 'partnership' ? splitName(s(b.name)) : { firstName: s(b.first_name, 60), surname: s(b.last_name, 60) };
  await ensureContactsSchema(env.DB);
  const id = randomId('ENQ', 10);
  await env.DB.prepare(
    `INSERT INTO enquiries (id, kind, first_name, surname, company, email, phone, subject, interest, category, message, privacy_consent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, kind === 'partnership' ? 'partnership' : 'contact', name.firstName || null, name.surname || null, s(b.company, 120) || null, email, s(b.phone, 30) || null,
    s(b.subject, 200) || null, s(b.interest, 120) || null, s(b.category, 60) || null, s(b.message, 5000) || null,
    b.privacy_consent ? 1 : 0).run();

  await captureContact(env, {
    source: kind === 'partnership' ? 'sponsorship' : kind === 'hospitality' ? 'hospitality' : 'contact_form', refTable: 'enquiries', refId: id,
    email, phone: b.phone, firstName: name.firstName, surname: name.surname, label: s(b.subject || b.interest, 120),
  });
  const [thread] = await syncEnquiries(env.DB, id);
  const later = Promise.all([thread ? alertNewThread(env, thread) : null, maybeDailySummary(env)]);
  if (waitUntil) waitUntil(later); else await later;
  return Response.json({ ok: true, ref: thread?.ref });
}
