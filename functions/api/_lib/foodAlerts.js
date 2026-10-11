// Food order alerts for staff.
//
//   🟡 New order – awaiting payment   (when a fan places an order)
//   🟢 PAID – start preparing          (when the payment is confirmed, once)
//
// Channels (switched on/off in Admin -> In-Seat Food -> Orders -> Alert settings):
//   - in the admin: bell, pop-up and sound (each admin page asks for new alerts);
//   - push notifications to staff phones/computers that pressed "Enable
//     notifications" (Web Push with VAPID keys; the push has no content and
//     the phone fetches the alert text from the site, so nothing about the
//     order travels through the push service);
//   - email to the alert addresses (paid orders by default);
//   - SMS / WhatsApp via Termii (off by default; needs TERMII_API_KEY).
import { sendEmail } from './email.js';

let ready = false;
export async function ensureAlertsSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS food_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, order_id TEXT NOT NULL, ref TEXT, title TEXT NOT NULL, body TEXT NOT NULL,
      created_at TEXT NOT NULL, UNIQUE (kind, order_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS push_subs (
      endpoint TEXT PRIMARY KEY, staff_id TEXT, staff_name TEXT, keys_json TEXT, want_unpaid INTEGER NOT NULL DEFAULT 0,
      want_paid INTEGER NOT NULL DEFAULT 1, device TEXT, created_at TEXT, last_ok_at TEXT
    )`),
  ]);
  ready = true;
}

export const ALERT_DEFAULTS = { push: true, emailPaid: true, emailUnpaid: false, emails: [], sms: false, smsNumbers: [], smsChannel: 'generic' };
export async function alertSettings(db) {
  const { results } = await db.prepare(`SELECT key, value FROM food_settings WHERE key LIKE 'alert.%'`).all().catch(() => ({ results: [] }));
  const s = { ...ALERT_DEFAULTS, emails: [], smsNumbers: [] };
  for (const r of results) {
    const k = r.key.slice(6);
    if (['push', 'emailPaid', 'emailUnpaid', 'sms'].includes(k)) s[k] = r.value === '1';
    if (k === 'smsChannel' && ['generic', 'whatsapp'].includes(r.value)) s.smsChannel = r.value;
    if (k === 'emails' || k === 'smsNumbers') { try { const v = JSON.parse(r.value); if (Array.isArray(v)) s[k] = v.map(String).filter(Boolean).slice(0, 20); } catch {} }
  }
  return s;
}

const naira = k => '₦' + (k / 100).toLocaleString('en-NG');
const itemsText = o => { try { return JSON.parse(o.items_json).map(i => `${i.qty}× ${i.name}`).join(', '); } catch { return ''; } };
export function alertText(kind, o) {
  const where = o.fulfilment === 'pickup' ? `Pickup: ${o.pickup_point || ''}` : `Seat ${o.seat}${o.stand ? `, ${o.stand}` : ''}`;
  if (kind === 'whatsapp') return { title: `💬 New WhatsApp order – confirm it: ${o.ref}`, body: `${o.customer_name || 'Fan'}, ${where}, ${itemsText(o)}, ${naira(o.total_kobo)}` };
  return kind === 'paid'
    ? { title: `🟢 PAID – start preparing: ${o.ref}`, body: `${o.customer_name || 'Fan'}, ${where}, ${itemsText(o)}, ${naira(o.total_kobo)}` }
    : { title: `🟡 New order – awaiting payment: ${o.ref}`, body: `${o.customer_name || 'Fan'}, ${where}, ${naira(o.total_kobo)}` };
}

/**
 * Records an alert (once per order and kind) and sends it on every switched-on
 * channel. Returns false if this alert was already sent.
 */
export async function raiseFoodAlert(env, kind, order, { waitUntil, origin = 'https://lobistarsfc.com' } = {}) {
  const db = env.DB;
  await ensureAlertsSchema(db);
  const { title, body } = alertText(kind, order);
  const res = await db.prepare(`INSERT INTO food_alerts (kind, order_id, ref, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (kind, order_id) DO NOTHING`)
    .bind(kind, order.id, order.ref, title, body, new Date().toISOString()).run();
  if (!res.meta?.changes) return false;
  const s = await alertSettings(db);
  const jobs = [];
  if (s.push) jobs.push(sendPushes(env, kind).catch(err => console.error('[alerts] push', err)));
  if (env.RESEND_API_KEY && s.emails.length && (kind === 'unpaid' ? s.emailUnpaid : s.emailPaid)) {
    jobs.push(sendEmail(env, {
      to: s.emails, subject: title,
      html: `<div style="font-family:Arial,sans-serif"><h2 style="margin:0 0 8px">${esc(title)}</h2><p style="font-size:16px">${esc(body)}</p>${order.notes ? `<p><b>Note:</b> ${esc(order.notes)}</p>` : ''}<p><a href="${origin}/admin/food-orders/live/">Open the live order board</a></p></div>`,
    }).catch(err => console.error('[alerts] email', err)));
  }
  if (kind !== 'unpaid' && s.sms && s.smsNumbers.length && env.TERMII_API_KEY) {
    jobs.push(sendTermii(env, s, `${title}\n${body}`).catch(err => console.error('[alerts] sms', err)));
  }
  const all = Promise.all(jobs);
  if (waitUntil) waitUntil(all); else await all;
  return true;
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── SMS / WhatsApp (Termii) ──
async function sendTermii(env, s, text) {
  for (const to of s.smsNumbers) {
    await fetch('https://api.ng.termii.com/api/sms/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: env.TERMII_API_KEY, to: to.replace(/^\+/, ''), from: env.TERMII_SENDER_ID || 'LobiStars', sms: text.slice(0, 300), type: 'plain', channel: s.smsChannel === 'whatsapp' ? 'whatsapp' : 'generic' }),
    });
  }
}

// ── Web Push (VAPID, no payload) ──
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
export const pushReady = env => !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

let signingKey = null;
async function vapidKey(env) {
  if (signingKey) return signingKey;
  const pub = unb64u(env.VAPID_PUBLIC_KEY); // 65 bytes: 0x04 || x || y
  signingKey = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE_KEY, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true,
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return signingKey;
}
async function vapidJwt(env, audience) {
  const enc = o => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const head = enc({ typ: 'JWT', alg: 'ES256' });
  const body = enc({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:info@lobistarsfc.com' });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidKey(env), new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(sig)}`;
}
/** The Authorization header for a push service (VAPID). */
export async function vapidAuth(env, endpoint) {
  return `vapid t=${await vapidJwt(env, new URL(endpoint).origin)}, k=${env.VAPID_PUBLIC_KEY}`;
}
export async function sendPushes(env, kind) {
  if (!pushReady(env)) return 0;
  const col = kind === 'unpaid' ? 'want_unpaid' : 'want_paid';
  const { results } = await env.DB.prepare(`SELECT endpoint FROM push_subs WHERE ${col} = 1`).all();
  let sent = 0;
  for (const { endpoint } of results) {
    try {
      const r = await fetch(endpoint, { method: 'POST', headers: { TTL: '3600', Urgency: kind === 'unpaid' ? 'normal' : 'high', Authorization: await vapidAuth(env, endpoint), 'Content-Length': '0' } });
      if (r.status === 404 || r.status === 410) await env.DB.prepare(`DELETE FROM push_subs WHERE endpoint = ?`).bind(endpoint).run();
      else if (r.ok) { sent++; await env.DB.prepare(`UPDATE push_subs SET last_ok_at = ? WHERE endpoint = ?`).bind(new Date().toISOString(), endpoint).run(); }
    } catch (err) { console.error('[alerts] push send', err); }
  }
  return sent;
}
