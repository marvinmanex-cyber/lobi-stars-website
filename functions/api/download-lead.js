import { ensureContactsSchema, captureContact, normEmail, splitName } from './_lib/contacts.js';
import { clientIp, rateLimit, tooMany, ensureFanSchema } from './_lib/fans.js';
import { recordServerEvent } from './_lib/analytics.js';
import { randomId } from './_lib/crypto.js';

// POST /api/download-lead { file: 'brochure', name, email, phone?, company?, marketing? }
// -- records who downloaded a file and returns the file's address.
export async function onRequestPost({ request, env }) {
  await ensureFanSchema(env.DB);
  if (!(await rateLimit(env.DB, `download:${clientIp(request)}`, 20, 3600))) return tooMany();
  let b;
  try { b = await request.json(); } catch { b = {}; }
  const s = (v, n = 120) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

  // Which files can be requested, and where they live (from the site's settings).
  let fileUrl = '';
  if (b.file === 'brochure') {
    try {
      const res = await env.ASSETS.fetch(new URL('/data/partnership.json', request.url));
      fileUrl = res.ok ? (await res.json()).brochureUrl || '' : '';
    } catch { fileUrl = ''; }
  }
  if (!fileUrl) return Response.json({ error: 'This download is not available yet.' }, { status: 404 });

  const email = normEmail(b.email);
  const name = splitName(s(b.name));
  const errors = {};
  if (!name.firstName) errors.name = 'Please enter your name.';
  if (!email) errors.email = 'Please enter a valid email address.';
  if (Object.keys(errors).length) return Response.json({ errors }, { status: 400 });

  await ensureContactsSchema(env.DB);
  const id = randomId('DL', 10);
  await env.DB.prepare(
    `INSERT INTO download_leads (id, file, first_name, surname, company, email, phone, marketing_consent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, 'brochure', name.firstName, name.surname || null, s(b.company) || null, email, s(b.phone, 30) || null, b.marketing === true ? 1 : 0).run();
  await captureContact(env, {
    source: 'download_lead', refTable: 'download_leads', refId: id, email, phone: b.phone,
    firstName: name.firstName, surname: name.surname, consent: b.marketing === true, label: 'Partnership brochure',
  });
  await recordServerEvent(env, 'brochure_download', 'brochure', request);
  return Response.json({ ok: true, url: fileUrl });
}
