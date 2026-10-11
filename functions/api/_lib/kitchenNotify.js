// Kitchen order alerts. When an order becomes PAID the kitchen is told by:
//   1. push notifications to the Kitchen Screen devices (/admin/kitchen/),
//      with the ticket inside the (encrypted) push, and
//   2. the Telegram kitchen group, with an "✅ Accept" button.
// Both are free. The kitchen must accept the order (Kitchen Screen, live
// order board or the Telegram button); until then it is alerted again every
// few minutes (Admin › Commerce › Kitchen Alerts), up to a maximum.
//
// Kitchen tickets never contain phone numbers, totals or payment details.
// Nothing here ever throws to the caller: an alert failing must never stop
// an order being saved or moved.
import { ensureAlertsSchema, pushReady } from './foodAlerts.js';
import { sendEncryptedPush } from './webPush.js';
import { ensureFoodSchema, whereText } from './foodOrders.js';

const nowIso = () => new Date().toISOString();
const lagosTime = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
export const escHtml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let ready = false;
export async function ensureKitchenSchema(db) {
  if (ready) return;
  await ensureFoodSchema(db);
  await ensureAlertsSchema(db);
  await db.prepare(`CREATE TABLE IF NOT EXISTS food_notification_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT, ref TEXT,
    channel TEXT NOT NULL,        -- push / telegram
    attempt TEXT NOT NULL,        -- initial / repeat / cancel / test
    success INTEGER NOT NULL,
    error TEXT,
    message_id TEXT,              -- Telegram message (to remove the Accept button later)
    created_at TEXT NOT NULL
  )`).run();
  // Kitchen Screen devices are push subscriptions marked kitchen = 1.
  const cols = new Set((await db.prepare(`PRAGMA table_info(push_subs)`).all()).results.map(r => r.name));
  for (const [name, type] of [['kitchen', 'INTEGER NOT NULL DEFAULT 0'], ['is_active', 'INTEGER NOT NULL DEFAULT 1']]) {
    if (!cols.has(name)) await db.prepare(`ALTER TABLE push_subs ADD COLUMN ${name} ${type}`).run();
  }
  ready = true;
}

// ── Settings (food_settings, keys kitchen.*) ──
export const KITCHEN_DEFAULTS = { enabled: true, telegram: true, repeatMinutes: 3, maxRepeats: 5 };
export async function kitchenSettings(db) {
  await ensureKitchenSchema(db);
  const { results } = await db.prepare(`SELECT key, value FROM food_settings WHERE key LIKE 'kitchen.%'`).all();
  const s = { ...KITCHEN_DEFAULTS };
  for (const r of results) {
    const k = r.key.slice(8);
    if (k === 'enabled' || k === 'telegram') s[k] = r.value === '1';
    if (k === 'repeatMinutes') s.repeatMinutes = Math.min(30, Math.max(1, Number(r.value) || 3));
    if (k === 'maxRepeats') s.maxRepeats = Math.min(20, Math.max(0, Number.isFinite(Number(r.value)) ? Number(r.value) : 5));
  }
  return s;
}
export async function saveKitchenSettings(db, v, by) {
  const now = nowIso();
  const pairs = [['enabled', v.enabled ? '1' : '0'], ['telegram', v.telegram ? '1' : '0'],
    ['repeatMinutes', String(Math.min(30, Math.max(1, Math.round(Number(v.repeatMinutes) || 3))))],
    ['maxRepeats', String(Math.min(20, Math.max(0, Math.round(Number(v.maxRepeats)))))]];
  await db.batch(pairs.map(([k, val]) => db.prepare(`INSERT INTO food_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).bind(`kitchen.${k}`, val, now, by || '')));
  return kitchenSettings(db);
}
export const telegramReady = env => !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_KITCHEN_CHAT_ID);

// ── The ticket ──
const itemsOf = o => { try { return JSON.parse(o.items_json); } catch { return []; } };
const firstName = o => String(o.customer_name || '').trim().split(/\s+/)[0] || 'Fan';

/** { title, body, longText } for one order. No phone, totals or payment details. */
export function buildKitchenTicket(order, attempt = 'initial') {
  const items = itemsOf(order);
  const where = whereText(order);
  const mins = order.paid_iso ? Math.max(0, Math.round((Date.now() - Date.parse(order.paid_iso)) / 60000)) : 0;
  const title = attempt === 'repeat' ? `⚠️ STILL WAITING: ${order.ref} (paid ${mins} min ago)`
    : attempt === 'cancel' ? `❌ ORDER ${order.ref} CANCELLED, do not cook`
    : attempt === 'test' ? '🔔 Test kitchen alert'
    : `🍽️ NEW PAID ORDER ${order.ref}`;
  const body = attempt === 'test' ? 'Kitchen alerts are working on this device.' : `${items.map(i => `${i.qty}× ${i.name}`).join(', ')} | ${where}`;
  const longText = [
    ...items.map(i => `${i.qty}× ${i.name}`),
    order.notes ? `📝 Note: ${order.notes}` : '',
    `👤 ${firstName(order)}`, `📍 ${where}`,
    order.paid_iso ? `🕒 Paid ${lagosTime(order.paid_iso)}` : '',
  ].filter(Boolean).join('\n');
  return { title, body, longText };
}
/** Telegram message (HTML; everything from the order is escaped). */
function telegramHtml(order, attempt) {
  const t = buildKitchenTicket(order, attempt);
  if (attempt === 'test') return `<b>${escHtml(t.title)}</b>\n${escHtml(t.body)}`;
  if (attempt === 'cancel') return `<b>${escHtml(t.title)}</b>\n${escHtml(whereText(order))}`;
  return `<b>${escHtml(t.title)}</b>\n\n${escHtml(t.longText)}`;
}

// ── Telegram ──
async function telegram(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) throw new Error(d.description || `Telegram ${r.status}`);
  return d.result;
}
export async function sendTelegram(env, html, ref, withAcceptButton) {
  const body = { chat_id: env.TELEGRAM_KITCHEN_CHAT_ID, text: html, parse_mode: 'HTML', disable_web_page_preview: true };
  if (withAcceptButton && ref) body.reply_markup = { inline_keyboard: [[{ text: '✅ Accept', callback_data: `ack:${ref}` }]] };
  const res = await telegram(env, 'sendMessage', body);
  return res?.message_id ? String(res.message_id) : null;
}
export { telegram as telegramApi };

/** After an order is accepted (anywhere), remove the Accept button from its Telegram messages. */
export async function clearTelegramButtons(env, db, orderId, note) {
  if (!telegramReady(env)) return;
  try {
    await ensureKitchenSchema(db);
    const { results } = await db.prepare(`SELECT message_id FROM food_notification_log WHERE order_id = ? AND channel = 'telegram' AND message_id IS NOT NULL AND attempt IN ('initial', 'repeat')`).bind(orderId).all();
    for (const { message_id } of results) {
      await telegram(env, 'editMessageReplyMarkup', { chat_id: env.TELEGRAM_KITCHEN_CHAT_ID, message_id: Number(message_id), reply_markup: { inline_keyboard: [] } }).catch(() => {});
    }
    if (note && results.length) await telegram(env, 'sendMessage', { chat_id: env.TELEGRAM_KITCHEN_CHAT_ID, text: note, parse_mode: 'HTML', reply_to_message_id: Number(results[results.length - 1].message_id) }).catch(() => {});
  } catch (err) { console.error('[kitchen] clear buttons', err); }
}

// ── Push to Kitchen Screen devices ──
async function pushKitchen(env, db, payload, topic) {
  if (!pushReady(env)) return { ok: false, error: 'Push not set up (VAPID keys missing)' };
  const { results } = await db.prepare(`SELECT endpoint, keys_json FROM push_subs WHERE kitchen = 1 AND is_active = 1`).all();
  if (!results.length) return { ok: false, error: 'No kitchen devices registered' };
  const out = await Promise.allSettled(results.map(async row => {
    const keys = JSON.parse(row.keys_json || '{}');
    if (!keys.p256dh || !keys.auth) return 'nokeys';
    const status = await sendEncryptedPush(env, { endpoint: row.endpoint, keys }, payload, { ttl: 300, urgency: 'high', topic });
    if (status === 404 || status === 410) await db.prepare(`UPDATE push_subs SET is_active = 0 WHERE endpoint = ?`).bind(row.endpoint).run();
    else if (status >= 200 && status < 300) await db.prepare(`UPDATE push_subs SET last_ok_at = ? WHERE endpoint = ?`).bind(nowIso(), row.endpoint).run();
    return status;
  }));
  const ok = out.filter(r => r.status === 'fulfilled' && r.value >= 200 && r.value < 300).length;
  return ok ? { ok: true, error: ok < results.length ? `${results.length - ok} of ${results.length} devices failed` : null } : { ok: false, error: `No device received it (${out.map(r => r.value || r.reason?.message).join(', ')})` };
}

async function log(db, order, channel, attempt, success, error, messageId = null) {
  try {
    await db.prepare(`INSERT INTO food_notification_log (order_id, ref, channel, attempt, success, error, message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(order?.id || null, order?.ref || null, channel, attempt, success ? 1 : 0, error ? String(error).slice(0, 300) : null, messageId, nowIso()).run();
  } catch (err) { console.error('[kitchen] log', err); }
}

/**
 * Alerts the kitchen about one order. attempt: 'initial' (once, when it
 * becomes PAID), 'repeat' (still not accepted), 'cancel' (an alerted order
 * was cancelled) or 'test'. Returns { sent, push, telegram } and never throws.
 */
export async function notifyKitchen(env, orderId, attempt = 'initial') {
  const db = env.DB;
  try {
    await ensureKitchenSchema(db);
    const s = await kitchenSettings(db);
    if (!s.enabled) return { sent: false, reason: 'Kitchen alerts are switched off' };
    let order = await db.prepare(`SELECT * FROM food_orders WHERE id = ?`).bind(orderId).first();
    if (!order) return { sent: false, reason: 'Order not found' };
    if ((attempt === 'initial' || attempt === 'repeat') && order.order_status !== 'PAID') return { sent: false, reason: 'Order is not waiting for the kitchen' };
    const now = nowIso();
    if (attempt === 'initial') {
      // Claim the first alert in one statement, so two requests can never both send it.
      const r = await db.prepare(`UPDATE food_orders SET kitchen_alerted_at = ?, last_alert_at = ? WHERE id = ? AND kitchen_alerted_at IS NULL`).bind(now, now, orderId).run();
      if (!r.meta?.changes) return { sent: false, reason: 'Already alerted' };
    } else if (attempt === 'repeat') {
      await db.prepare(`UPDATE food_orders SET last_alert_at = ?, kitchen_alerted_at = COALESCE(kitchen_alerted_at, ?) WHERE id = ?`).bind(now, now, orderId).run();
    }
    order = { ...order, kitchen_alerted_at: order.kitchen_alerted_at || now };
    const t = buildKitchenTicket(order, attempt);
    const payload = { kind: 'kitchen', attempt, title: t.title, body: attempt === 'repeat' || attempt === 'initial' ? `${t.body}${order.notes ? ` | 📝 ${order.notes}` : ''}` : t.body, ref: order.ref, url: `/admin/kitchen/?order=${encodeURIComponent(order.ref)}` };
    const button = attempt === 'initial' || attempt === 'repeat';
    // Both channels at once; each is logged as soon as it finishes, and one failing never stops the other.
    const pushJob = pushKitchen(env, db, payload, order.ref)
      .catch(err => ({ ok: false, error: err.message }))
      .then(async r => { await log(db, order, 'push', attempt, r.ok, r.error); return r; });
    const tgJob = !s.telegram ? Promise.resolve(null)
      : (telegramReady(env)
        ? sendTelegram(env, telegramHtml(order, attempt), order.ref, button).then(id => ({ ok: true, id }), err => ({ ok: false, error: err.message }))
        : Promise.resolve({ ok: false, error: 'Telegram not set up (bot token / chat id missing)' }))
        .then(async r => { await log(db, order, 'telegram', attempt, r.ok, r.error, r.id || null); return r; });
    const [push, tg] = await Promise.allSettled([pushJob, tgJob]);
    const pushRes = push.status === 'fulfilled' ? push.value : { ok: false, error: push.reason?.message };
    const tgRes = tg.status === 'fulfilled' ? tg.value : { ok: false, error: tg.reason?.message };
    return { sent: true, push: pushRes, telegram: tgRes };
  } catch (err) {
    console.error('[kitchen] notify', err);
    return { sent: false, reason: err.message };
  }
}

/** A test alert to every kitchen device and the Telegram group. */
export async function testKitchen(env) {
  const db = env.DB;
  await ensureKitchenSchema(db);
  const s = await kitchenSettings(db);
  const fake = { id: null, ref: 'TEST', customer_name: '', items_json: '[]' };
  const t = buildKitchenTicket(fake, 'test');
  const pushRes = await pushKitchen(env, db, { kind: 'kitchen', attempt: 'test', title: t.title, body: t.body, ref: 'TEST', url: '/admin/kitchen/' }, 'test').catch(err => ({ ok: false, error: err.message }));
  await log(db, fake, 'push', 'test', pushRes.ok, pushRes.error);
  let tgRes = null;
  if (s.telegram) {
    tgRes = telegramReady(env) ? await sendTelegram(env, telegramHtml(fake, 'test'), null, false).then(id => ({ ok: true, id })).catch(err => ({ ok: false, error: err.message })) : { ok: false, error: 'Telegram not set up (bot token / chat id missing)' };
    await log(db, fake, 'telegram', 'test', tgRes.ok, tgRes.error, tgRes.id || null);
  }
  return { push: pushRes, telegram: tgRes };
}

/**
 * Re-alerts PAID orders nobody has accepted: every `repeatMinutes`, at most
 * `maxRepeats` times. Each order's count is bumped with a conditional update
 * first, so two runs at the same time never both send. Returns how many were sent.
 */
export async function runKitchenRepeats(env, { olderThanMs } = {}) {
  const db = env.DB;
  try {
    await ensureKitchenSchema(db);
    const s = await kitchenSettings(db);
    if (!s.enabled || !s.maxRepeats) return 0;
    const cutoff = new Date(Date.now() - (olderThanMs ?? s.repeatMinutes * 60000)).toISOString();
    const { results } = await db.prepare(
      `SELECT id, repeat_count FROM food_orders WHERE order_status = 'PAID' AND kitchen_ack_at IS NULL AND kitchen_alerted_at IS NOT NULL
         AND repeat_count < ? AND (last_alert_at IS NULL OR last_alert_at <= ?) ORDER BY paid_iso LIMIT 20`
    ).bind(s.maxRepeats, cutoff).all();
    let sent = 0;
    for (const o of results) {
      const r = await db.prepare(`UPDATE food_orders SET repeat_count = repeat_count + 1, last_alert_at = ? WHERE id = ? AND repeat_count = ? AND kitchen_ack_at IS NULL`).bind(nowIso(), o.id, o.repeat_count).run();
      if (!r.meta?.changes) continue;
      await notifyKitchen(env, o.id, 'repeat');
      sent++;
    }
    return sent;
  } catch (err) {
    console.error('[kitchen] repeats', err);
    return 0;
  }
}

/**
 * Call this whenever an order becomes PAID (Paystack confirmation, or staff
 * marking a WhatsApp order paid). Any future payment route must call it too.
 */
export function kitchenOnPaid(env, orderId, waitUntil) {
  const job = notifyKitchen(env, orderId, 'initial');
  if (waitUntil) waitUntil(job);
  return job;
}

/** Kitchen status line for the admin ("Alerted 19:42", "Accepted by … at …", "⚠️ Not accepted, 4 min"). */
export function kitchenStatus(o) {
  if (o.kitchen_ack_at) return { state: 'accepted', text: `Accepted by ${o.kitchen_ack_by || 'kitchen'} at ${lagosTime(o.kitchen_ack_at)}` };
  if (o.order_status === 'PAID' && o.kitchen_alerted_at) {
    const m = Math.max(0, Math.round((Date.now() - Date.parse(o.kitchen_alerted_at)) / 60000));
    return { state: m >= 2 ? 'late' : 'alerted', text: m >= 2 ? `⚠️ Not accepted, ${m} min${o.repeat_count ? ` (${o.repeat_count} repeat${o.repeat_count === 1 ? '' : 's'})` : ''}` : `Alerted ${lagosTime(o.kitchen_alerted_at)}` };
  }
  if (o.kitchen_alerted_at) return { state: 'alerted', text: `Alerted ${lagosTime(o.kitchen_alerted_at)}` };
  return null;
}
