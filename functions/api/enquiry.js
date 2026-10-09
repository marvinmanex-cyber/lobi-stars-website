import { ensureContactsSchema, captureContact, normEmail, splitName } from './_lib/contacts.js';
import { clientIp, rateLimit, tooMany, ensureFanSchema } from './_lib/fans.js';
import { randomId } from './_lib/crypto.js';

// POST /api/enquiry -- saves a Contact Us or partnership enquiry to the
// database (the browser also still sends it to the club's Formspree inbox).
export async function onRequestPost({ request, env }) {
  await ensureFanSchema(env.DB);
  if (!(await rateLimit(env.DB, `enquiry:${clientIp(request)}`, 10, 3600))) return tooMany();
  let b;
  try { b = await request.json(); } catch { b = {}; }
  const s = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const kind = b.form === 'partnership' ? 'partnership' : 'contact';
  const email = normEmail(b.email);
  if (!email) return Response.json({ error: 'Please enter a valid email address.' }, { status: 400 });

  const name = kind === 'partnership' ? splitName(s(b.name)) : { firstName: s(b.first_name, 60), surname: s(b.last_name, 60) };
  await ensureContactsSchema(env.DB);
  const id = randomId('ENQ', 10);
  await env.DB.prepare(
    `INSERT INTO enquiries (id, kind, first_name, surname, company, email, phone, subject, interest, category, message, privacy_consent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, kind, name.firstName || null, name.surname || null, s(b.company, 120) || null, email, s(b.phone, 30) || null,
    s(b.subject, 200) || null, s(b.interest, 120) || null, s(b.category, 60) || null, s(b.message, 5000) || null,
    b.privacy_consent ? 1 : 0).run();

  await captureContact(env, {
    source: kind === 'partnership' ? 'sponsorship' : 'contact_form', refTable: 'enquiries', refId: id,
    email, phone: b.phone, firstName: name.firstName, surname: name.surname, label: s(b.subject || b.interest, 120),
  });
  return Response.json({ ok: true });
}
