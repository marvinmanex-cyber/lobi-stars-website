// The order workflow against a running server: the history, reasons, refunds, what each role can
// see and do, venues, the missing-ingredient flag, alert settings and two-step sign-in.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './media-helpers.mjs';
import { hashPassword } from '../functions/api/_lib/password.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const T = Date.now().toString(36).toUpperCase();
const rows = q => JSON.parse(sql(q))[0].results;
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const SA_EMAIL = `wf-sa-${T.toLowerCase()}@example.com`, SA2_EMAIL = `wf-sb-${T.toLowerCase()}@example.com`, PW = 'Kitchen-Super-2026!';

async function login(body) {
  const r = await fetch(`${BASE}/api/matchday-kitchen/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})), cookie: ((r.headers.get('set-cookie') || '').match(/ls_mdk=([^;]+)/) || [])[1] };
}
async function as(cookie) {
  const s = await fetch(`${BASE}/api/matchday-kitchen/session`, { headers: { Cookie: `ls_mdk=${cookie}` } }).then(r => r.json());
  const call = (path, body) => fetch(`${BASE}/api/matchday-kitchen/${path}`, body ? { method: 'POST', headers: { Cookie: `ls_mdk=${cookie}`, 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf }, body: JSON.stringify(body) } : { headers: { Cookie: `ls_mdk=${cookie}` } })
    .then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
  return { s, call };
}
const orderIds = [], staffIds = [], venues = [];
const made = {};
const put = (status, { paid = false, channel = 'paystack', fulfilment = 'seat', venue = 'venue-main', email = '' } = {}) => {
  const id = `WF${orderIds.length}${T}`;
  orderIds.push(id);
  sql(`INSERT INTO food_orders (id, ref, seat, stand, phone, email, items_json, total_kobo, paystack_reference, payment_status, order_status, paid_iso, created_iso, channel, customer_name, view_token, venue_id, fulfilment, pickup_point) VALUES ('${id}', '${id}', 'A1', 'Popular Stand', '+2348031234567', '${email}', '[{"id":"x","name":"Suya","qty":1,"priceKobo":150000}]', 150000, 'r-${id}', '${paid ? 'paid' : 'pending'}', '${status}', ${paid ? `'${new Date().toISOString()}'` : 'NULL'}, '${new Date().toISOString()}', '${channel}', 'Abigail Fan', 'tok${id}', '${venue}', '${fulfilment}', ${fulfilment === 'pickup' ? "'Kiosk'" : 'NULL'});`);
  return id;
};
const status = id => rows(`SELECT order_status FROM food_orders WHERE id = '${id}'`)[0].order_status;
const events = id => rows(`SELECT from_status, to_status, kind, by_name, by_role, reason, note FROM order_events WHERE order_id = '${id}' ORDER BY id`);
const pub = id => fetch(`${BASE}/api/food/order?ref=${id}&t=tok${id}`).then(r => r.json());

let A, S, P, C, R;
async function staff(name, role, by = A, extra = {}) {
  const a = await by.call('staff', { action: 'add', name: `${name} ${T}`, role, ...extra });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  staffIds.push(a.data.id);
  return { id: a.data.id, code: a.data.loginCode, u: await as((await login({ loginCode: a.data.loginCode })).cookie) };
}

test('set up: a Super Admin and one person per role', async () => {
  const hash = await hashPassword(PW);
  await fetch(`${BASE}/api/food/menu`); // creates the food tables on a new database
  sql(`CREATE TABLE IF NOT EXISTS mk_alert_prefs (user_id TEXT PRIMARY KEY, level TEXT NOT NULL, updated_at TEXT); DELETE FROM mk_alert_prefs; DELETE FROM mk_settings WHERE key = 'alert_fallback'; UPDATE mk_shifts SET ended_at = '${new Date().toISOString()}' WHERE ended_at IS NULL; DELETE FROM admin_users WHERE role = 'super_admin' AND test_account = 1; INSERT INTO admin_users (id, name, email, password_hash, role, active, test_account) VALUES ('wf_a_${T}', 'WF One', '${SA_EMAIL}', '${hash}', 'super_admin', 1, 1), ('wf_b_${T}', 'WF Two', '${SA2_EMAIL}', '${hash}', 'super_admin', 1, 1);`);
  A = await as((await login({ login: SA_EMAIL, password: PW })).cookie);
  S = (await staff('WF Sup', 'supervisor')).u; P = (await staff('WF Pass', 'pass')).u; C = (await staff('WF Cook', 'cook')).u; R = (await staff('WF Run', 'delivery')).u;
  assert.equal(R.s.user.role, 'delivery');
  assert.equal(C.s.perms.reports, false); assert.equal(S.s.perms.reports, true);
});

test('the whole journey: right people at each step, every step in the history', async () => {
  const id = put('PAID', { paid: true });
  for (const who of [C, R, P]) assert.equal((await who.call('order', { id, to: 'ACCEPTED' })).status, 403, 'only supervisors confirm');
  assert.equal((await S.call('order', { id, to: 'READY' })).status, 409, 'no skipping');
  assert.equal((await S.call('order', { id, to: 'ACCEPTED' })).status, 200);
  assert.equal(status(id), 'ACCEPTED', 'accepted stays accepted until someone presses Start cooking');
  assert.equal((await R.call('order', { id, to: 'PREPARING' })).status, 403);
  assert.equal((await C.call('order', { id, to: 'PREPARING' })).status, 200);
  assert.equal((await S.call('order', { id, to: 'ACCEPTED' })).status, 409, 'no going back');
  assert.equal((await C.call('order', { id, to: 'READY' })).status, 200);
  const k = (await R.call('kitchen')).data.tickets.find(t => t.id === id);
  assert.equal(k.next.label, 'Take for delivery');
  assert.ok((await R.call('pulse')).data.ready.some(x => x.id === id), 'runners hear it');
  assert.ok(!(await C.call('pulse')).data.ready.some(x => x.id === id), 'cooks don\'t');
  assert.equal((await C.call('order', { id, to: 'OUT_FOR_DELIVERY' })).status, 403);
  assert.equal((await R.call('order', { id, to: 'OUT_FOR_DELIVERY' })).status, 200);
  assert.equal((await R.call('order', { id, to: 'DELIVERED' })).status, 200);
  assert.equal(status(id), 'DELIVERED');
  assert.deepEqual(events(id).map(e => e.to_status), ['ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED']);
  assert.deepEqual(events(id).map(e => e.by_role), ['supervisor', 'cook', 'cook', 'delivery', 'delivery']);
  assert.match(events(id)[0].by_name, /WF Sup/);
  const log = rows(`SELECT before_json, after_json FROM mk_activity WHERE action LIKE 'Order ${id}:%' ORDER BY id`);
  assert.equal(log.length, 5); assert.equal(JSON.parse(log[0].before_json).status, 'PAID'); assert.equal(JSON.parse(log[0].after_json).status, 'ACCEPTED');
  assert.equal((await S.call(`order?id=${id}`)).data.events.length, 5, 'supervisors see the history');
  assert.deepEqual((await C.call(`order?id=${id}`)).data.events, [], 'cooks don\'t');
});

test('a pickup order is collected without a runner', async () => {
  const id = put('READY', { paid: true, fulfilment: 'pickup' });
  assert.equal((await C.call(`order?id=${id}`)).data.order.next.label, 'Collected');
  assert.equal((await R.call('order', { id, to: 'DELIVERED' })).status, 200);
  const seat = put('READY', { paid: true });
  assert.equal((await S.call('order', { id: seat, to: 'DELIVERED' })).status, 409);
});

test('rejecting: a reason is required, a refund record for a paid order, the fan sees why', async () => {
  const id = put('PAID', { paid: true });
  assert.equal((await S.call('order', { id, to: 'REJECTED' })).data.needReason, true);
  assert.equal((await S.call('order', { id, to: 'REJECTED', reason: 'other' })).data.needReason, true, 'other needs a note');
  assert.equal((await C.call('order', { id, to: 'REJECTED', reason: 'sold_out' })).status, 403);
  assert.equal((await S.call('order', { id, to: 'REJECTED', reason: 'sold_out', note: 'No suya left' })).status, 200);
  assert.equal(status(id), 'REJECTED');
  const f = rows(`SELECT reject_reason, reject_note FROM food_orders WHERE id = '${id}'`)[0];
  assert.equal(f.reject_reason, 'sold_out'); assert.equal(f.reject_note, 'No suya left');
  const refund = rows(`SELECT amount_kobo, status, reason FROM food_refunds WHERE order_id = '${id}'`)[0];
  assert.equal(refund.amount_kobo, 150000); assert.equal(refund.status, 'manual'); assert.match(refund.reason, /sold_out/);
  const seen = (await pub(id)).order;
  assert.equal(seen.rejectReason, 'An item is sold out'); assert.match(seen.refundNote, /refunded/);
  assert.doesNotMatch(JSON.stringify(seen), /WF Sup/, 'no staff details for the fan');
  const log = (await S.call(`order?id=${id}`)).data;
  assert.equal(log.order.rejectReason, 'sold_out'); assert.equal(log.chat, null, 'nothing to send on WhatsApp');
  // Not paid: no refund record.
  const un = put('AWAITING_WHATSAPP', { channel: 'whatsapp' });
  assert.equal((await S.call('order', { id: un, to: 'REJECTED', reason: 'kitchen_at_capacity' })).status, 200);
  assert.equal(rows(`SELECT 1 FROM food_refunds WHERE order_id = '${un}'`).length, 0);
  assert.equal((await pub(un)).order.refundNote, '');
  assert.ok(!(await S.call('pulse')).data.whatsapp.some(x => x.id === un), 'rejected: quiet');
});

test('cancelling: supervisors with a reason; a refund record when paid', async () => {
  const id = put('PREPARING', { paid: true });
  assert.equal((await P.call('order', { id, to: 'CANCELLED', note: 'x' })).status, 403, 'order handlers can\'t any more');
  assert.equal((await S.call('order', { id, to: 'CANCELLED' })).data.needReason, true);
  assert.equal((await S.call('order', { id, to: 'CANCELLED', note: 'Fan left the ground' })).status, 200);
  assert.match(rows(`SELECT cancel_reason FROM food_orders WHERE id = '${id}'`)[0].cancel_reason, /Fan left/);
  assert.equal(rows(`SELECT status FROM food_refunds WHERE order_id = '${id}'`)[0].status, 'manual');
  const done = put('DELIVERED', { paid: true });
  assert.equal((await S.call('order', { id: done, to: 'CANCELLED', note: 'x' })).status, 409, 'not after delivery');
});

test('failed delivery: the runner reports it, a supervisor decides', async () => {
  const id = put('OUT_FOR_DELIVERY', { paid: true });
  assert.equal((await C.call('order', { id, to: 'FAILED_DELIVERY' })).status, 403);
  assert.equal((await R.call('order', { id, to: 'FAILED_DELIVERY' })).status, 200);
  assert.ok((await S.call('pulse')).data.failed.some(x => x.id === id), 'the supervisor hears it');
  assert.equal((await R.call('order', { id, to: 'READY' })).status, 403);
  assert.equal((await S.call('order', { id, to: 'READY' })).status, 200, 'try again');
  assert.equal(status(id), 'READY');
});

test('cooks and runners never see totals, payment details or the fan\'s number', async () => {
  const cooking = put('PREPARING', { paid: true, channel: 'whatsapp' }), ready = put('READY', { paid: true }), waiting = put('AWAITING_WHATSAPP', { channel: 'whatsapp' });
  const clean = v => { const t = JSON.stringify(v); assert.doesNotMatch(t, /"total|"phone|"paid"|paidNote|chatUrl|wa\.me/, t.slice(0, 200)); };
  clean((await C.call(`order?id=${cooking}`)).data.order);
  clean((await C.call('kitchen')).data.tickets.find(t => t.id === cooking));
  clean((await R.call('kitchen')).data.tickets.find(t => t.id === ready));
  clean((await R.call('delivery')).data.groups);
  clean((await C.call('board')).data);
  assert.ok((await C.call('board')).data.unpaid.some(u => u.id === waiting), 'but they do see the order');
  const sup = (await S.call(`order?id=${cooking}`)).data.order;
  assert.ok(sup.total); assert.ok(sup.phone.includes('•'));
  // Each screen shows that role's orders.
  assert.ok(!(await C.call('kitchen')).data.tickets.some(t => t.id === ready));
  assert.ok(!(await R.call('kitchen')).data.tickets.some(t => t.id === cooking));
  assert.ok((await S.call('kitchen')).data.tickets.some(t => t.id === cooking && t.total));
  for (const who of [C, R, P]) assert.equal((await who.call('analytics')).status, 403);
  assert.equal((await S.call('analytics')).status, 200);
});

test('a missing ingredient: the kitchen tells the supervisors', async () => {
  const id = put('PREPARING', { paid: true });
  assert.equal((await R.call('flag', { id, note: 'x y' })).status, 403);
  assert.equal((await C.call('flag', { id, note: '' })).status, 400);
  assert.equal((await C.call('flag', { id, note: 'No more pepper' })).status, 200);
  const f = (await S.call('pulse')).data.flags.find(x => x.id === id);
  assert.equal(f.note, 'No more pepper');
  assert.equal((await C.call('pulse')).data.flags.length, 0);
  assert.equal((await C.call('flag-ack', { flagId: f.flagId })).status, 403);
  assert.equal((await S.call('flag-ack', { flagId: f.flagId })).status, 200);
  assert.ok(!(await S.call('pulse')).data.flags.some(x => x.id === id));
});

test('venues: staff only see their own; Super Admins see all and manage them', async () => {
  assert.equal((await S.call('venue', { name: 'Nope' })).status, 403);
  const v = await A.call('venue', { name: `Second Ground ${T}`, settings: { whatsappNumber: '2348000000000' } });
  assert.equal(v.status, 200); venues.push(v.data.id);
  assert.equal((await A.call('venue', { name: 'Bad', settings: { whatsappNumber: '12' } })).status, 400);
  assert.ok((await A.call('venues')).data.venues.some(x => x.id === v.data.id));
  assert.ok(!(await S.call('venues')).data.venues.some(x => x.id === v.data.id));
  const main = (await A.call('venues')).data.venues.find(x => x.id === 'venue-main');
  assert.equal(main.settings.whatsappNumber, '2347080094985', 'the first venue carries the kitchen\'s number');
  const there = put('PAID', { paid: true, venue: v.data.id });
  assert.ok(!(await S.call('kitchen')).data.tickets.some(t => t.id === there), 'another venue\'s orders are hidden');
  assert.equal((await S.call(`order?id=${there}`)).status, 404);
  assert.equal((await S.call('order', { id: there, to: 'ACCEPTED' })).status, 404);
  assert.ok(!(await S.call('pulse')).data.newOrders.some(x => x.id === there));
  assert.equal((await S.call(`orders?q=${there}`)).data.total, 0);
  assert.ok((await A.call('kitchen')).data.tickets.some(t => t.id === there), 'a Super Admin sees every venue');
  const other = await staff('WF Other', 'supervisor', A, { venueId: v.data.id });
  assert.ok((await other.u.call('kitchen')).data.tickets.some(t => t.id === there));
  assert.ok(!(await other.u.call('kitchen')).data.tickets.some(t => t.status === 'PAID' && t.venueId === 'venue-main'));
  // A supervisor's new staff join their venue, and they can't change people elsewhere.
  const added = await staff('WF New', 'cook', S, { venueId: v.data.id });
  assert.equal(rows(`SELECT venue_id FROM mk_staff WHERE id = '${added.id}'`)[0].venue_id, 'venue-main');
  assert.equal((await S.call('staff', { action: 'edit', id: other.id, active: false })).status, 403);
  // New orders know their venue.
  assert.equal(rows(`SELECT COUNT(*) AS n FROM food_orders WHERE venue_id IS NULL`)[0].n, 0);
});

test('Super Admin alert levels and the safety rule; nobody else can mute', async () => {
  for (const who of [S, P, C, R]) {
    assert.equal((await who.call('alert-settings', { level: 'off' })).status, 403);
    assert.equal((await who.call('alert-settings')).status, 403);
  }
  const A2 = await as((await login({ login: SA2_EMAIL, password: PW })).cookie);
  sql(`UPDATE mk_shifts SET ended_at = '${new Date().toISOString()}' WHERE ended_at IS NULL;`);
  sql(`INSERT OR REPLACE INTO mk_alert_prefs (user_id, level) SELECT id, 'off' FROM admin_users WHERE id NOT IN ('wf_a_${T}', 'wf_b_${T}');`); // any other Super Admin on this test database
  const id = put('PAID', { paid: true });
  assert.equal((await A.call('alert-settings', { level: 'urgent' })).status, 200);
  assert.ok((await A.call('pulse')).data.newOrders.some(x => x.id === id), 'urgent only: hears a new order');
  const cooking = put('ACCEPTED', { paid: true });
  assert.ok(!(await A.call('pulse')).data.cook.some(x => x.id === cooking), 'but not the routine ones');
  assert.equal((await A.call('alert-settings', { level: 'off' })).status, 200, 'the other Super Admin still hears');
  assert.equal((await A.call('pulse')).data.newOrders.length, 0);
  const last = await A2.call('alert-settings', { level: 'off' });
  assert.equal(last.status, 409, 'the last person can\'t mute'); assert.match(last.data.error, /can't switch off/);
  assert.equal((await A2.call('alert-settings', { level: 'off', fallbackId: 'nobody' })).status, 400);
  assert.equal((await A2.call('alert-settings', { level: 'off', fallbackId: `wf_b_${T}` })).status, 409, 'not your own fallback');
  assert.equal((await A2.call('alert-settings', { level: 'off', fallbackId: `wf_a_${T}` })).status, 200, 'with someone else as fallback');
  sql(`DELETE FROM mk_alert_prefs; DELETE FROM mk_settings WHERE key = 'alert_fallback';`);
  // A supervisor on shift: a Super Admin may switch off.
  assert.equal((await S.call('shift', { action: 'start' })).status, 200);
  assert.equal((await A.call('alert-settings', { level: 'off' })).status, 200);
  assert.ok((await S.call('pulse')).data.newOrders.some(x => x.id === id), 'the supervisor still hears');
  await S.call('shift', { action: 'end' });
  sql(`DELETE FROM mk_alert_prefs;`);
});

test('opening an order marks its alerts as seen', async () => {
  const id = put('PAID', { paid: true });
  const me = S.s.user.id;
  sql(`INSERT INTO food_notification_log (order_id, ref, channel, attempt, success, created_at, event, recipient) VALUES ('${id}', '${id}', 'push', 'initial', 1, '${new Date().toISOString()}', 'ORDER_NEW', '${me}');`);
  await S.call(`order?id=${id}`);
  assert.ok(rows(`SELECT opened_at FROM food_notification_log WHERE order_id = '${id}' AND recipient = '${me}'`)[0].opened_at);
});

test('Super Admins need the two-step code to sign in to the kitchen', async () => {
  const emails = (process.env.SUPER_ADMIN_TEST_EMAIL || 'owner2@example.com');
  const hash = await hashPassword(PW);
  sql(`DELETE FROM admin_users WHERE email = '${emails}'; INSERT INTO admin_users (id, name, email, password_hash, role, active, test_account, totp_enabled) VALUES ('wf_real_${T}', 'Real SA', '${emails}', '${hash}', 'super_admin', 1, 0, 0);`);
  try {
    const none = await login({ login: emails, password: PW });
    assert.equal(none.status, 403); assert.match(none.data.error, /two-step/);
    sql(`UPDATE admin_users SET totp_enabled = 1, totp_secret = 'JBSWY3DPEHPK3PXP', totp_last_step = 0 WHERE email = '${emails}';`);
    const ask = await login({ login: emails, password: PW });
    assert.equal(ask.status, 401); assert.equal(ask.data.needCode, true); assert.equal(ask.cookie, undefined);
    const wrong = await login({ login: emails, password: PW, otp: '000000' });
    assert.equal(wrong.status, 401); assert.equal(wrong.cookie, undefined);
  } finally { sql(`DELETE FROM admin_users WHERE email = '${emails}';`); }
});

// ── Phase 2 ──
const CRON = { Authorization: 'Bearer cron-test-secret' };
const tick = () => fetch(`${BASE}/api/internal/kitchen-repeat`, { method: 'POST', headers: CRON }).then(r => r.json());
const minsAgo = m => new Date(Date.now() - m * 60000).toISOString();

test('claiming is atomic: two runners, one order, one wins', async () => {
  const other = await staff('WF Run Two', 'delivery');
  const id = put('READY', { paid: true });
  const res = await Promise.all([R.call('order', { id, to: 'OUT_FOR_DELIVERY' }), other.u.call('order', { id, to: 'OUT_FOR_DELIVERY' })]);
  assert.deepEqual(res.map(r => r.status).sort(), [200, 409], JSON.stringify(res.map(r => r.data)));
  const row = rows(`SELECT claimed_by, claimed_name FROM food_orders WHERE id = '${id}'`)[0];
  const winner = res[0].status === 200 ? R : other.u, loser = res[0].status === 200 ? other.u : R;
  assert.equal(row.claimed_by, winner.s.user.id);
  // Only the runner who has it finishes it; other runners don't see it; a supervisor can change it.
  assert.equal((await loser.call('order', { id, to: 'DELIVERED' })).status, 403);
  assert.ok(!(await loser.call('kitchen')).data.tickets.some(t => t.id === id));
  assert.ok((await winner.call('kitchen')).data.tickets.some(t => t.id === id && t.claimedName));
  assert.equal((await loser.call('reassign', { id, staffId: loser.s.user.id })).status, 403);
  assert.equal((await S.call('reassign', { id, staffId: loser.s.user.id })).status, 200);
  assert.equal(rows(`SELECT claimed_by FROM food_orders WHERE id = '${id}'`)[0].claimed_by, loser.s.user.id);
  assert.equal((await loser.call('order', { id, to: 'DELIVERED' })).status, 200);
  assert.equal((await S.call('reassign', { id, staffId: 'nobody' })).status, 409, 'not once delivered');
  const seen = await pub(id);
  assert.doesNotMatch(JSON.stringify(seen), /WF Run/, 'no staff details for the fan');
});

test('delivery code: the fan has it, everyone is asked for it, a supervisor can skip it only with a reason, recorded', async () => {
  const id = put('OUT_FOR_DELIVERY', { paid: true });
  sql(`UPDATE food_orders SET delivery_code = '4821' WHERE id = '${id}';`);
  assert.equal((await pub(id)).order.deliveryCode, '4821', 'on the fan\'s order page');
  assert.doesNotMatch(JSON.stringify((await R.call(`order?id=${id}`)).data), /4821/, 'never shown to staff');
  assert.equal((await R.call('order', { id, to: 'DELIVERED' })).data.needCode, true);
  assert.equal((await R.call('order', { id, to: 'DELIVERED', code: '1111' })).data.needCode, true);
  assert.equal(status(id), 'OUT_FOR_DELIVERY');
  assert.equal((await R.call('order', { id, to: 'DELIVERED', code: '48 21' })).status, 200);
  assert.equal((await pub(id)).order.deliveryCode, '', 'gone once delivered');
  const two = put('OUT_FOR_DELIVERY', { paid: true });
  sql(`UPDATE food_orders SET delivery_code = '1234' WHERE id = '${two}';`);
  const asked = (await S.call('order', { id: two, to: 'DELIVERED' })).data;
  assert.equal(asked.needCode, true, 'the supervisor is asked for the code too'); assert.equal(asked.canSkip, true);
  assert.equal((await S.call('order', { id: two, to: 'DELIVERED', withoutCode: true })).data.needCode, true, 'skipping needs a reason');
  assert.equal((await R.call('order', { id: two, to: 'DELIVERED', withoutCode: true, note: 'lost phone' })).data.needCode, true, 'a runner cannot skip');
  assert.equal((await S.call('order', { id: two, to: 'DELIVERED', withoutCode: true, note: 'Fan lost their phone; seat and name checked' })).status, 200);
  assert.match(events(two).at(-1).note, /without the fan's code: Fan lost their phone/);
  // A pickup order has no code to give; and a new order gets one.
  const pick = put('READY', { paid: true, fulfilment: 'pickup' });
  sql(`UPDATE food_orders SET delivery_code = '9999' WHERE id = '${pick}';`);
  assert.equal((await pub(pick)).order.deliveryCode, '');
  assert.equal((await R.call('order', { id: pick, to: 'DELIVERED' })).status, 200);
});

test('escalation: overdue orders alert once each', async () => {
  const late = put('PAID', { paid: true }), fresh = put('PAID', { paid: true }), cook = put('PREPARING', { paid: true }), ready = put('READY', { paid: true }), out = put('OUT_FOR_DELIVERY', { paid: true });
  sql(`UPDATE food_orders SET paid_iso = '${minsAgo(5)}' WHERE id = '${late}'; UPDATE food_orders SET preparing_at = '${minsAgo(20)}' WHERE id = '${cook}'; UPDATE food_orders SET ready_at = '${minsAgo(5)}' WHERE id = '${ready}'; UPDATE food_orders SET out_at = '${minsAgo(15)}' WHERE id = '${out}';`);
  const r = await tick();
  assert.ok(r.escalations.escalated >= 4, JSON.stringify(r));
  const kinds = id => rows(`SELECT kind FROM order_escalations WHERE order_id = '${id}'`).map(x => x.kind);
  assert.deepEqual(kinds(late), ['esc_new']); assert.deepEqual(kinds(fresh), []); assert.deepEqual(kinds(cook), ['esc_preparing']); assert.deepEqual(kinds(ready), ['esc_ready']); assert.deepEqual(kinds(out), ['esc_out']);
  assert.ok(rows(`SELECT 1 FROM food_notification_log WHERE order_id = '${late}' AND event = 'ESCALATION_NEW'`).length);
  assert.ok(events(cook).some(e => e.kind === 'escalation'));
  const again = await tick();
  assert.equal(rows(`SELECT COUNT(*) AS n FROM order_escalations WHERE order_id = '${late}'`)[0].n, 1, 'once only');
  assert.equal((await fetch(`${BASE}/api/internal/kitchen-repeat`, { method: 'POST' })).status, 403);
  sql(`DELETE FROM order_escalations WHERE order_id LIKE 'WF%${T}';`);
  void again;
});

test('kick-off and half-time orders stay quiet until they are due', async () => {
  const id = put('ACCEPTED', { paid: true });
  sql(`UPDATE food_orders SET accepted_iso = '${minsAgo(1)}', deliver_when = 'half-time', deliver_at = '${new Date(Date.now() + 2 * 3600e3).toISOString()}' WHERE id = '${id}';`);
  assert.ok(!(await C.call('pulse')).data.cook.some(x => x.id === id));
  await tick();
  assert.equal(rows(`SELECT 1 FROM order_escalations WHERE order_id = '${id}' AND kind = 'release'`).length, 0);
  sql(`UPDATE food_orders SET accepted_iso = '${minsAgo(120)}', deliver_at = '${new Date(Date.now() + 10 * 60000).toISOString()}' WHERE id = '${id}';`);
  assert.ok((await C.call('pulse')).data.cook.some(x => x.id === id), 'due soon: rings');
  await tick();
  assert.equal(rows(`SELECT 1 FROM order_escalations WHERE order_id = '${id}' AND kind = 'release'`).length, 1, 'and the devices are told');
});

test('the match-day shift: only people clocked in hear alerts; forgetting it can\'t silence the kitchen', async () => {
  const id = put('ACCEPTED', { paid: true });
  assert.equal((await C.call('venue-shift', { action: 'start' })).status, 403);
  assert.ok((await C.call('pulse')).data.cook.some(x => x.id === id), 'no shift running: everyone hears');
  assert.equal((await S.call('venue-shift', { action: 'start' })).status, 200);
  assert.equal((await S.call('venue-shift', { action: 'start' })).status, 409);
  assert.equal((await C.call('venue-shift')).data.running, true);
  assert.equal((await C.call('pulse')).data.offDuty, true, 'not clocked in: quiet');
  assert.equal((await C.call('shift', { action: 'start' })).status, 200);
  assert.ok((await C.call('pulse')).data.cook.some(x => x.id === id), 'clocked in: hears');
  assert.ok((await A.call('pulse')).data.cook.some(x => x.id === id), 'a Super Admin isn\'t on shifts');
  assert.equal((await S.call('venue-shift', { action: 'end' })).status, 200);
  assert.equal((await C.call('shift')).data.onShift, false, 'ending it clocks everyone out');
  assert.equal((await C.call('venue-shift')).data.running, false);
});

test('pausing and capacity: fans are told, and orders stop', async () => {
  const fan = () => fetch(`${BASE}/api/food/menu`).then(r => r.json());
  const order = () => fetch(`${BASE}/api/food/whatsapp-order`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ name: 'Pause Fan', phone: `0803${String(Math.random()).slice(2, 9)}`, fulfilment: 'seat', seat: 'P1', stand: 'Popular Stand', items: [{ id: 'water', qty: 1 }] }) });
  sql(`INSERT INTO food_settings (key, value) VALUES ('orderingMode', 'open') ON CONFLICT (key) DO UPDATE SET value = 'open';`);
  try {
    assert.equal((await C.call('venue-settings', { paused: true })).status, 403);
    assert.equal((await S.call('venue-settings', { paused: true, pauseMessage: 'Back in five minutes' })).status, 200);
    const m = await fan();
    assert.equal(m.open, false); assert.equal(m.reason, 'paused'); assert.equal(m.message, 'Back in five minutes');
    const refused = await order();
    assert.equal(refused.status, 503); assert.match((await refused.json()).error, /Back in five/);
    assert.equal((await S.call('ordering')).data.paused, true);
    assert.equal((await S.call('venue-settings', { paused: false })).status, 200);
    assert.equal((await fan()).open, true);
    const n = rows(`SELECT COUNT(*) AS n FROM food_orders WHERE order_status IN ('PAID', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY') AND COALESCE(venue_id, 'venue-main') = 'venue-main'`)[0].n;
    assert.equal((await S.call('venue-settings', { maxOpenOrders: n + 1 })).status, 200);
    assert.equal((await fan()).open, true);
    put('PAID', { paid: true });
    assert.equal((await fan()).reason, 'capacity');
    const logged = rows(`SELECT before_json, after_json FROM mk_activity WHERE action = 'Changed venue settings' ORDER BY id DESC LIMIT 1`)[0];
    assert.equal(JSON.parse(logged.after_json).maxOpenOrders, n + 1);
  } finally { await S.call('venue-settings', { maxOpenOrders: 0, paused: false, pauseMessage: '' }); }
});

test('a dish turned off at one venue stays on at another', async () => {
  const v = await A.call('venue', { name: `Third Ground ${T}` }); venues.push(v.data.id);
  const menu = async venue => (await fetch(`${BASE}/api/food/menu${venue ? `?venue=${venue}` : ''}`).then(r => r.json())).categories.flatMap(c => c.items).find(i => i.id === 'water');
  sql(`UPDATE food_items SET sold_out = 0, archived = 0, available = 1 WHERE id = 'water'; INSERT INTO food_settings (key, value) VALUES ('orderingMode', 'open') ON CONFLICT (key) DO UPDATE SET value = 'open';`);
  assert.equal((await A.call('menu', { id: 'water', action: 'soldout', venueId: v.data.id })).status, 200);
  assert.equal((await menu(v.data.id)).soldOut, true);
  assert.equal((await menu()).soldOut, false, 'the first venue is untouched');
  assert.ok((await A.call(`menu?venue=${v.data.id}`)).data.groups.flatMap(g => g.dishes).find(d => d.id === 'water').soldOut);
  const buy = await fetch(`${BASE}/api/food/whatsapp-order`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ venueId: v.data.id, name: 'Venue Fan', phone: `0803${String(Math.random()).slice(2, 9)}`, fulfilment: 'seat', seat: 'V1', stand: 'Popular Stand', items: [{ id: 'water', qty: 1 }] }) });
  assert.equal(buy.status, 409, 'can\'t be ordered there');
  sql(`DELETE FROM food_item_venue WHERE venue_id = '${v.data.id}';`);
});

test('refunds: the limit, Paystack and by hand, only once', async () => {
  const pay = put('PAID', { paid: true }), wa = put('PAID', { paid: true, channel: 'whatsapp' });
  await S.call('order', { id: pay, to: 'REJECTED', reason: 'sold_out' });
  await S.call('order', { id: wa, to: 'REJECTED', reason: 'sold_out' });
  assert.equal((await C.call('refunds')).status, 403);
  assert.ok((await S.call('refunds')).data.refunds.some(r => r.id === pay && r.status === 'manual'));
  // Above the limit: a Super Admin only.
  assert.equal((await A.call('venue-settings', { refundApprovalNaira: 1000 })).status, 200);
  assert.ok((await S.call('refunds')).data.refunds.find(r => r.id === pay).needsSuperAdmin);
  assert.equal((await S.call('refund', { id: pay, action: 'refund' })).data.needsSuperAdmin, true);
  assert.equal((await C.call('refund', { id: pay, action: 'refund' })).status, 403);
  // Under the limit: a supervisor can.
  assert.equal((await A.call('venue-settings', { refundApprovalNaira: 20000 })).status, 200);
  assert.equal((await S.call('refund', { id: wa, action: 'refund' })).status, 400, 'a WhatsApp payment can\'t go through Paystack');
  assert.equal(rows(`SELECT status FROM food_refunds WHERE order_id = '${wa}'`)[0].status, 'manual', 'and nothing has changed');
  assert.equal((await S.call('refund', { id: wa, action: 'done' })).status, 200);
  assert.equal(rows(`SELECT status FROM food_refunds WHERE order_id = '${wa}'`)[0].status, 'done'); assert.equal(status(wa), 'REFUNDED');
  const sent = await S.call('refund', { id: pay, action: 'refund' });
  assert.equal(sent.data.status, 'sent', JSON.stringify(sent.data)); assert.equal(status(pay), 'REFUNDED');
  assert.equal((await S.call('refund', { id: pay, action: 'refund' })).status, 409, 'only once');
  assert.equal(events(pay).at(-1).to_status, 'REFUNDED');
  assert.ok(rows(`SELECT 1 FROM mk_activity WHERE action LIKE 'Order ${pay}: refunded%'`).length);
});

after(() => {
  sql(`DELETE FROM order_escalations WHERE order_id LIKE 'WF%${T}'; DELETE FROM order_events WHERE order_id LIKE 'WF%${T}'; DELETE FROM food_refunds WHERE order_id LIKE 'WF%${T}'; DELETE FROM food_notification_log WHERE order_id LIKE 'WF%${T}'; DELETE FROM food_orders WHERE id LIKE 'WF%${T}'; DELETE FROM mk_staff WHERE full_name LIKE 'WF %'; DELETE FROM admin_users WHERE email IN ('${SA_EMAIL}', '${SA2_EMAIL}');${venues.map(v => `DELETE FROM mk_venues WHERE id = '${v}';`).join('')}`);
});
