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
import { ensureFoodSchema, whereText, REJECT_REASONS } from './foodOrders.js';
import { recipientsFor, eventOf, isLoud, STAFF, zoneOf } from './kitchenWorkflow.js';
import { customerUpdate } from './kitchenCustomer.js';
import { ensureKitchenSchema as ensureStaffSchema } from './matchdayKitchen.js';
import { dutyIds, getVenue, preorderHeld } from './kitchenOps.js';

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
  // mk_app = 1: a device registered in the MatchDay Kitchen staff app (its alerts open that app, not the admin).
  for (const [name, type] of [['kitchen', 'INTEGER NOT NULL DEFAULT 0'], ['is_active', 'INTEGER NOT NULL DEFAULT 1'], ['mk_app', 'INTEGER NOT NULL DEFAULT 0']]) {
    if (!cols.has(name)) await db.prepare(`ALTER TABLE push_subs ADD COLUMN ${name} ${type}`).run();
  }
  // The log also says which event, who it went to and when they opened the order.
  const logCols = new Set((await db.prepare(`PRAGMA table_info(food_notification_log)`).all()).results.map(r => r.name));
  for (const name of ['event', 'recipient', 'opened_at']) if (!logCols.has(name)) await db.prepare(`ALTER TABLE food_notification_log ADD COLUMN ${name} TEXT`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_food_log_open ON food_notification_log (order_id, recipient, opened_at)`).run();
  // Super Admins' alert level (all / urgent / off). Nobody else has one: staff on duty can't mute.
  await db.prepare(`CREATE TABLE IF NOT EXISTS mk_alert_prefs (user_id TEXT PRIMARY KEY, level TEXT NOT NULL, updated_at TEXT)`).run();
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
    : attempt === 'whatsapp' ? `💬 NEW WHATSAPP ORDER ${order.ref}: confirm it`
    : attempt === 'cook' ? `🍳 START COOKING ${order.ref}`
    : attempt === 'ready' ? `🛎️ READY ${order.ref}: take it out`
    : attempt === 'out' ? `🛵 ON THE WAY ${order.ref}`
    : attempt === 'delivered' ? `✅ DELIVERED ${order.ref}`
    : attempt === 'rejected' ? `⛔ REJECTED ${order.ref}`
    : attempt === 'failed' ? `⚠️ DELIVERY FAILED ${order.ref}: decide what next`
    : attempt === 'flag' ? `⚠️ MISSING INGREDIENT ${order.ref}`
    : attempt === 'esc_new' ? `⚠️ NOT CONFIRMED YET: ${order.ref}`
    : attempt === 'esc_preparing' ? `⚠️ STILL COOKING: ${order.ref}`
    : attempt === 'esc_ready' ? `⚠️ NOBODY HAS TAKEN ${order.ref}`
    : attempt === 'esc_out' ? `⚠️ STILL NOT DELIVERED: ${order.ref}`
    : attempt === 'release' ? `🍳 START COOKING ${order.ref}: due soon`
    : `🍽️ NEW PAID ORDER ${order.ref}`;
  const body = attempt === 'test' ? 'Kitchen alerts are working on this device.' : `${items.map(i => `${i.qty}× ${i.name}`).join(', ')} | ${where}${attempt === 'whatsapp' ? ' | Not paid yet: do not cook' : ''}`;
  const longText = [
    ...items.map(i => `${i.qty}× ${i.name}`),
    order.notes ? `📝 Note: ${order.notes}` : '',
    `👤 ${firstName(order)}`, `📍 ${where}`,
    order.paid_iso ? `🕒 Paid ${lagosTime(order.paid_iso)}` : '',
    attempt === 'whatsapp' ? '⏳ Not paid yet: do not cook' : '',
  ].filter(Boolean).join('\n');
  return { title, body, longText };
}
/** Telegram message (HTML; everything from the order is escaped). */
function telegramHtml(order, attempt) {
  const t = buildKitchenTicket(order, attempt);
  if (attempt === 'test') return `<b>${escHtml(t.title)}</b>\n${escHtml(t.body)}`;
  if (attempt === 'cancel') return `<b>${escHtml(t.title)}</b>\n${escHtml(whereText(order))}`;
  if (attempt === 'rejected') return `<b>${escHtml(t.title)}</b>\n${escHtml(REJECT_REASONS[order.reject_reason] || '')}`;
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
/** Every kitchen device, with the role of the person it belongs to. */
async function kitchenDevices(db) {
  await ensureStaffSchema(db);
  const { results } = await db.prepare(`SELECT p.endpoint, p.keys_json, p.mk_app, p.staff_id, s.role, s.venue_id, s.zone_id FROM push_subs p LEFT JOIN mk_staff s ON s.id = p.staff_id WHERE p.kitchen = 1 AND p.is_active = 1`).all();
  // A device in the app with no kitchen staff account belongs to a Super Admin. Anything else is an admin Kitchen Screen.
  return results.map(r => ({ ...r, staffId: r.staff_id, venueId: r.venue_id || null, zoneId: r.zone_id || null, role: r.mk_app ? (r.role || STAFF.SA) : 'screen' }));
}
export async function alertLevels(db) {
  const { results } = await db.prepare(`SELECT user_id, level FROM mk_alert_prefs`).all();
  return Object.fromEntries(results.map(r => [r.user_id, r.level]));
}
export async function alertFallback(db) {
  return (await db.prepare(`SELECT value FROM mk_settings WHERE key = 'alert_fallback'`).first().catch(() => null))?.value || null;
}
async function pushKitchen(env, db, payload, topic, { event = null, order = null, attempt = 'initial' } = {}) {
  if (!pushReady(env)) return { ok: false, error: 'Push not set up (VAPID keys missing)' };
  const all = await kitchenDevices(db);
  const results = event ? recipientsFor(event, all, { levels: await alertLevels(db), fallbackId: await alertFallback(db), cookWasPreparing: !!order?.was_preparing, venueId: order?.venue_id || null, duty: order?.venue_id ? await dutyIds(db, order.venue_id) : null, orderZone: order?.venue_id ? zoneOf(order.stand, (await getVenue(db, order.venue_id))?.settings.zones) : null }) : all;
  if (!results.length) return { ok: false, error: all.length ? 'Nobody on this alert has a device registered' : 'No kitchen devices registered' };
  const out = await Promise.allSettled(results.map(async row => {
    const keys = JSON.parse(row.keys_json || '{}');
    if (!keys.p256dh || !keys.auth) return 'nokeys';
    const { mkUrl, ...rest } = payload;
    const body = { ...(row.mk_app ? { ...rest, url: mkUrl || '/matchday-kitchen/' } : rest), loud: !event || isLoud(event, row.role) };
    const status = await sendEncryptedPush(env, { endpoint: row.endpoint, keys }, body, { ttl: 300, urgency: body.loud ? 'high' : 'normal', topic });
    if (status === 404 || status === 410) await db.prepare(`UPDATE push_subs SET is_active = 0 WHERE endpoint = ?`).bind(row.endpoint).run();
    else if (status >= 200 && status < 300) await db.prepare(`UPDATE push_subs SET last_ok_at = ? WHERE endpoint = ?`).bind(nowIso(), row.endpoint).run();
    if (order) await log(db, order, 'push', attempt, status >= 200 && status < 300, status >= 200 && status < 300 ? null : `Status ${status}`, null, { event, recipient: row.staffId });
    return status;
  }));
  const ok = out.filter(r => r.status === 'fulfilled' && r.value >= 200 && r.value < 300).length;
  return ok ? { ok: true, error: ok < results.length ? `${results.length - ok} of ${results.length} devices failed` : null } : { ok: false, error: `No device received it (${out.map(r => r.value || r.reason?.message).join(', ')})` };
}

async function log(db, order, channel, attempt, success, error, messageId = null, { event = null, recipient = null } = {}) {
  try {
    await db.prepare(`INSERT INTO food_notification_log (order_id, ref, channel, attempt, success, error, message_id, created_at, event, recipient) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(order?.id || null, order?.ref || null, channel, attempt, success ? 1 : 0, error ? String(error).slice(0, 300) : null, messageId, nowIso(), event, recipient).run();
  } catch (err) { console.error('[kitchen] log', err); }
}

/**
 * Alerts the kitchen about one order. attempt: 'initial' (once, when it
 * becomes PAID), 'repeat' (still not accepted), 'whatsapp' (a new WhatsApp order
 * to confirm: not paid yet, so it never uses up the paid alert), 'cook' (confirmed
 * and paid: cooking is pending), 'cancel' (an
 * alerted order was cancelled) or 'test'. Returns { sent, push, telegram } and never throws.
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
    order = { ...order, kitchen_alerted_at: order.kitchen_alerted_at || now, was_preparing: !!order.preparing_at };
    const t = buildKitchenTicket(order, attempt);
    const event = eventOf(attempt);
    // A busy minute: one alert saying how many, in place of separate pop-ups.
    let burst = 0;
    if (event === 'ORDER_NEW' && attempt !== 'repeat') {
      burst = (await db.prepare(`SELECT COUNT(*) AS n FROM food_orders WHERE order_status IN ('PAID', 'AWAITING_WHATSAPP') AND COALESCE(paid_iso, created_iso) >= ?`).bind(new Date(Date.now() - 60e3).toISOString()).first())?.n || 0;
    }
    const grouped = burst >= 3;
    const payload = { kind: 'kitchen', attempt, title: grouped ? `🔔 ${burst} new orders` : t.title, body: grouped ? 'Tap to see them' : attempt === 'repeat' || attempt === 'initial' ? `${t.body}${order.notes ? ` | 📝 ${order.notes}` : ''}` : t.body, ref: grouped ? 'burst' : order.ref, url: `/admin/kitchen/?order=${encodeURIComponent(order.ref)}`, mkUrl: grouped ? '/matchday-kitchen/?open=live' : `/matchday-kitchen/?open=${encodeURIComponent(`orders/${order.ref}`)}` };
    const button = attempt === 'initial' || attempt === 'repeat';
    const toGroup = !['out', 'delivered'].includes(attempt);
    // Both channels at once; each is logged as soon as it finishes, and one failing never stops the other.
    const pushJob = pushKitchen(env, db, payload, grouped ? 'burst' : order.ref, { event, order, attempt })
      .catch(err => ({ ok: false, error: err.message }))
      // Each device is logged as it is sent to; this line is for when none could be tried.
      .then(async r => { if (!r.ok) await log(db, order, 'push', attempt, false, r.error, null, { event }); return r; });
    const tgJob = !s.telegram || !toGroup ? Promise.resolve(null)
      : (telegramReady(env)
        ? sendTelegram(env, telegramHtml(order, attempt), order.ref, button).then(id => ({ ok: true, id }), err => ({ ok: false, error: err.message }))
        : Promise.resolve({ ok: false, error: 'Telegram not set up (bot token / chat id missing)' }))
        .then(async r => { await log(db, order, 'telegram', attempt, r.ok, r.error, r.id || null, { event }); return r; });
    const [push, tg] = await Promise.allSettled([pushJob, tgJob]);
    const pushRes = push.status === 'fulfilled' ? push.value : { ok: false, error: push.reason?.message };
    const tgRes = tg.status === 'fulfilled' ? tg.value : { ok: false, error: tg.reason?.message };
    return { sent: true, push: pushRes, telegram: tgRes };
  } catch (err) {
    console.error('[kitchen] notify', err);
    return { sent: false, reason: err.message };
  }
}

// ── Devices registered in the MatchDay Kitchen staff app ──
/** This person's device gets kitchen alerts. Returns an error text, or null. */
export async function saveAppDevice(db, user, sub, deviceName) {
  if (typeof sub?.endpoint !== 'string' || sub.endpoint.length > 1000 || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return 'This device could not be set up for alerts.';
  await ensureKitchenSchema(db);
  await db.prepare(`INSERT INTO push_subs (endpoint, staff_id, staff_name, keys_json, want_unpaid, want_paid, device, created_at, kitchen, is_active, mk_app) VALUES (?, ?, ?, ?, 0, 0, ?, ?, 1, 1, 1)
    ON CONFLICT (endpoint) DO UPDATE SET staff_id = excluded.staff_id, staff_name = excluded.staff_name, keys_json = excluded.keys_json, device = excluded.device, kitchen = 1, is_active = 1, mk_app = 1`)
    .bind(sub.endpoint, user.id, user.name, JSON.stringify({ p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) }), String(deviceName || '').trim().slice(0, 60) || 'Kitchen device', nowIso()).run();
  return null;
}
export async function removeAppDevice(db, endpoint) {
  await ensureKitchenSchema(db);
  await db.prepare(`UPDATE push_subs SET is_active = 0 WHERE endpoint = ? AND mk_app = 1`).bind(String(endpoint || '')).run();
}
/** Signed out with the button, switched off or given a new code: no more orders on that person's devices. */
export async function removeStaffDevices(db, userId) {
  await ensureKitchenSchema(db);
  await db.prepare(`UPDATE push_subs SET is_active = 0 WHERE staff_id = ? AND mk_app = 1`).bind(String(userId)).run();
}
/** A test alert to one device of the app. */
export async function testAppDevice(env, endpoint) {
  await ensureKitchenSchema(env.DB);
  const row = await env.DB.prepare(`SELECT endpoint, keys_json FROM push_subs WHERE endpoint = ? AND mk_app = 1 AND is_active = 1`).bind(String(endpoint || '')).first();
  if (!row || !pushReady(env)) return false;
  const t = buildKitchenTicket({ ref: 'TEST', items_json: '[]' }, 'test');
  try {
    const status = await sendEncryptedPush(env, { endpoint: row.endpoint, keys: JSON.parse(row.keys_json || '{}') }, { kind: 'kitchen', attempt: 'test', title: t.title, body: t.body, ref: 'TEST', url: '/matchday-kitchen/' }, { ttl: 300, urgency: 'high', topic: 'test' });
    return status >= 200 && status < 300;
  } catch { return false; }
}

/** Staff and customer alerts for one status change. Never throws. */
export async function notifyMove(env, order, to) {
  const attempt = { ACCEPTED: 'cook', READY: 'ready', OUT_FOR_DELIVERY: 'out', DELIVERED: 'delivered', REJECTED: 'rejected', CANCELLED: 'cancel', FAILED_DELIVERY: 'failed' }[to];
  // Straight to Preparing from the admin's screens: cooks still need to know.
  const staff = attempt || (to === 'PREPARING' && order.order_status === 'PAID' ? 'cook' : null);
  // A kick-off or half-time order isn't for the cooks yet: the every-minute check releases it when it is due.
  const held = staff === 'cook' && preorderHeld(order, (await getVenue(env.DB, order.venue_id))?.settings || { preorderMinutes: 30 });
  if (staff && !held) await notifyKitchen(env, order.id, staff);
  const customer = { ACCEPTED: 'accepted', OUT_FOR_DELIVERY: 'out', DELIVERED: 'delivered', REJECTED: 'rejected' }[to];
  if (!customer) return;
  await ensureKitchenSchema(env.DB);
  const fresh = await env.DB.prepare(`SELECT * FROM food_orders WHERE id = ?`).bind(order.id).first();
  await customerUpdate(env, fresh || order, customer, (channel, ok, error) => log(env.DB, order, channel, `customer_${customer}`, ok, error, null, { event: eventOf(staff), recipient: 'customer' }));
}
/** The person has opened the order: their alerts about it count as seen. */
export async function markOpened(db, orderId, userId) {
  try {
    await ensureKitchenSchema(db);
    await db.prepare(`UPDATE food_notification_log SET opened_at = ? WHERE order_id = ? AND recipient = ? AND opened_at IS NULL`).bind(nowIso(), String(orderId), String(userId)).run();
  } catch (err) { console.error('[kitchen] opened', err); }
}

/**
 * The pre-match test: an alert to every device at the venue, and who it reached. "Reached" means
 * the phone's push service took it; people with no device are listed too.
 */
export async function testAlerts(env, venueId) {
  const db = env.DB;
  await ensureKitchenSchema(db);
  const devices = (await kitchenDevices(db)).filter(d => d.mk_app && (d.role === STAFF.SA || !d.venueId || d.venueId === venueId));
  const staff = (await db.prepare(`SELECT id, full_name, role FROM mk_staff WHERE is_active = 1 AND COALESCE(venue_id, ?) = ?`).bind(venueId, venueId).all()).results;
  const results = await Promise.all(devices.map(async d => {
    let ok = false, error = null;
    try {
      const keys = JSON.parse(d.keys_json || '{}');
      const status = pushReady(env) ? await sendEncryptedPush(env, { endpoint: d.endpoint, keys }, { kind: 'kitchen', attempt: 'test', loud: true, title: '🔔 Pre-match test alert', body: 'Alerts are working on this device.', ref: 'TEST', url: '/matchday-kitchen/' }, { ttl: 300, urgency: 'high', topic: 'test' }) : 0;
      ok = status >= 200 && status < 300;
      if (!ok) error = pushReady(env) ? `Status ${status}` : 'Push not set up';
    } catch (err) { error = err.message; }
    await log(db, null, 'push', 'test', ok, error, null, { event: 'TEST', recipient: d.staffId });
    return { staffId: d.staffId, ok, error };
  }));
  const names = Object.fromEntries(staff.map(s => [s.id, s]));
  const people = staff.map(s => {
    const mine = results.filter(r => r.staffId === s.id);
    return { name: s.full_name, role: s.role, devices: mine.length, reached: mine.filter(r => r.ok).length };
  });
  const admins = results.filter(r => !names[r.staffId]);
  return { people, otherDevices: admins.length, otherReached: admins.filter(r => r.ok).length, reached: results.filter(r => r.ok).length, total: results.length };
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
