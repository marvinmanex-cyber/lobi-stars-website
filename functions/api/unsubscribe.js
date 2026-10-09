import { ensureContactsSchema, unsubscribeContact } from './_lib/contacts.js';

// POST /api/unsubscribe { t } -- the unsubscribe link in marketing emails.
// Sets Marketing Consent = N for that person.
export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch { b = {}; }
  const t = typeof b.t === 'string' ? b.t.trim() : '';
  if (!/^[a-f0-9]{36}$/.test(t)) return Response.json({ error: 'This unsubscribe link is not valid.' }, { status: 400 });
  await ensureContactsSchema(env.DB);
  const c = await env.DB.prepare(`SELECT * FROM contacts WHERE unsub_token = ?`).bind(t).first();
  if (!c) return Response.json({ error: 'This unsubscribe link is not valid or has already been used for a deleted account.' }, { status: 404 });
  await unsubscribeContact(env.DB, c);
  return Response.json({ ok: true });
}
