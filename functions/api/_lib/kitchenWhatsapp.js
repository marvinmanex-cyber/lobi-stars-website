// The kitchen's one WhatsApp number: orders go to it and replies come from it.
// A website can't see which WhatsApp account a phone is signed in to (a wa.me link opens whatever
// is on that phone), so replying is tied to the device: a Super Admin approves the kitchen's own
// phone or computer once, and it gets a long-lived private cookie. Only such a device receives
// reply links and the fan's number; every other device sees the orders and nothing to reply with.
import { staffMessage, OFFICIAL_WHATSAPP } from './foodOrders.js';
import { waNumber } from './foodReceipt.js';

export const WA_COOKIE = 'ls_mk_wa';
const MAX_DEVICES = 4;
const nowIso = () => new Date().toISOString();
const hashToken = async (env, token) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mk-wa:${env.SESSION_SECRET}:${token}`)))].map(b => b.toString(16).padStart(2, '0')).join('');

let ready = false;
async function ensure(db) {
  if (ready) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS mk_wa_devices (
    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL, added_by TEXT, added_at TEXT NOT NULL, removed_at TEXT, removed_by TEXT)`).run();
  ready = true;
}

/** The approved device's id, or null. Costs nothing on a device without the cookie. */
export async function officialDevice(request, env) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${WA_COOKIE}=([A-Za-z0-9_-]{20,100})`));
  if (!m) return null;
  await ensure(env.DB);
  const row = await env.DB.prepare(`SELECT id FROM mk_wa_devices WHERE token_hash = ? AND removed_at IS NULL`).bind(await hashToken(env, m[1])).first();
  return row?.id || null;
}

export async function listDevices(db) {
  await ensure(db);
  const { results } = await db.prepare(`SELECT id, name, added_by, added_at FROM mk_wa_devices WHERE removed_at IS NULL ORDER BY added_at`).all();
  return results.map(d => ({ id: d.id, name: d.name, addedBy: d.added_by, addedAt: d.added_at }));
}

/** Approves the device making this request. Returns { cookie, id, name } or { error }. */
export async function addDevice(env, request, name, by) {
  await ensure(env.DB);
  if (await officialDevice(request, env)) return { error: 'This device is already the official WhatsApp device.' };
  if ((await listDevices(env.DB)).length >= MAX_DEVICES) return { error: `There can be at most ${MAX_DEVICES} official WhatsApp devices. Remove one first.` };
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
  const id = `wad-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`, label = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Kitchen device';
  await env.DB.prepare(`INSERT INTO mk_wa_devices (id, token_hash, name, added_by, added_at) VALUES (?, ?, ?, ?, ?)`).bind(id, await hashToken(env, token), label, by, nowIso()).run();
  return { id, name: label, cookie: `${WA_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=34560000` };
}

export async function removeDevice(db, id, by) {
  await ensure(db);
  const d = await db.prepare(`SELECT name FROM mk_wa_devices WHERE id = ? AND removed_at IS NULL`).bind(String(id || '')).first();
  if (!d) return { error: 'That device is no longer on the list.' };
  await db.prepare(`UPDATE mk_wa_devices SET removed_at = ?, removed_by = ? WHERE id = ?`).bind(nowIso(), by, String(id)).run();
  return { ok: true, name: d.name };
}

/** The reply that fits where the order is. A rejected or cancelled order gets no message. */
export function replyFor(settings, o) {
  const to = waNumber(o.phone || '');
  const step = { AWAITING_WHATSAPP: ['CONFIRMED', 'Send the payment details'], CONFIRMED: ['CONFIRMED', 'Send the payment details'], PAID: ['PAID', 'Tell the fan it is paid'], ACCEPTED: ['PAID', 'Tell the fan it is paid'], PREPARING: ['PAID', 'Tell the fan it is paid'], OUT_FOR_DELIVERY: ['READY', 'Tell the fan it is ready'] }[o.order_status];
  if (!to || !step) return null;
  return { label: step[1], url: `https://wa.me/${to}?text=${encodeURIComponent(staffMessage(settings, o, step[0]))}` };
}

export { OFFICIAL_WHATSAPP };
