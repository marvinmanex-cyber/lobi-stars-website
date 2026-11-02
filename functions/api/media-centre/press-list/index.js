import { ensurePressSchema, listContacts, saveStaffContact, deleteContact, importContacts, MEDIA_TYPES } from '../../_lib/pressList.js';
import { ROLES } from '../../_lib/accreditationCards.js';
import { json } from '../../_lib/mediaCentre.js';

// Media Centre › Press List (Media Centre users only; never shown on public pages).
// GET  -- every contact, the matches people applied for, media types and roles.
// POST { action: 'add' | 'edit', ...contact } | { action: 'delete', email } | { action: 'import', rows, consent }
export async function onRequestGet({ env }) {
  await ensurePressSchema(env.DB);
  return json({ ...(await listContacts(env.DB)), mediaTypes: MEDIA_TYPES, roles: ROLES.map(r => r.name) });
}
export async function onRequestPost({ request, env, data }) {
  const b = await request.json().catch(() => ({}));
  const user = data.mc.user;
  let r;
  if (b.action === 'add') r = await saveStaffContact(env.DB, user, { ...b, originalEmail: '' }, request);
  else if (b.action === 'edit') r = await saveStaffContact(env.DB, user, { ...b, originalEmail: b.originalEmail || b.email }, request);
  else if (b.action === 'delete') r = await deleteContact(env.DB, user, b.email, request);
  else if (b.action === 'import') r = await importContacts(env.DB, user, b.rows, b.consent === true, request);
  else r = { error: 'Unknown action.' };
  return r.ok ? json(r) : json({ error: r.error }, 400);
}
