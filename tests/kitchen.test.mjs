// Kitchen order alerts: one alert when an order is paid, the kitchen ticket
// (no phone numbers or totals), the Kitchen Screen moves (accept -> cooking ->
// ready, exact moves only), repeat alerts until accepted, the Telegram Accept
// button (webhook secret, kitchen group only), cancel alerts, settings, roles.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123,
// TELEGRAM_KITCHEN_CHAT_ID=-1001, TELEGRAM_WEBHOOK_SECRET=tg-test-secret and CRON_SECRET=cron-test-secret.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildKitchenTicket } from '../functions/api/_lib/kitchenNotify.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const TG_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || 'tg-test-secret';
const CHAT = process.env.TELEGRAM_KITCHEN_CHAT_ID || '-1001';
const CRON = process.env.CRON_SECRET || 'cron-test-secret';
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const r7 = () => String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const api = (path, method = 'GET', body, headers = ADMIN) => fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const made = [];
after(async () => {
  for (const id of made) await fetch(`${BASE}/api/admin/staff/${id}`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ active: false, reason: 'test finished' }) });
  await api('/api/admin/kitchen/settings', 'POST', { settings: { enabled: true, telegram: true, repeatMinutes: 3, maxRepeats: 5 } });
});

/** A WhatsApp order marked paid by staff (the kitchen is alerted). */
async function paidOrder(name = 'Ada Obi') {
  const r = await fetch(`${BASE}/api/food/whatsapp-order`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ name, phone: `0803${r7()}`, seat: 'B7', stand: 'VIP', notes: 'Extra pepper', items: [{ id: 'suya', qty: 2 }, { id: 'water', qty: 1 }] }) }).then(x => x.json());
  const id = (await api('/api/admin/food-orders?show=board')).data.orders.find(o => o.ref === r.ref).id;
  assert.equal((await api('/api/admin/food-orders', 'POST', { id, status: 'PAID' })).status, 200);
  return { ref: r.ref, id };
}
// Alerts are logged in the background: wait until push and Telegram are both there (up to 8 s).
const logFor = async (ref, done = log => log.some(l => l.channel === 'push') && log.some(l => l.channel === 'telegram')) => {
  let log = [];
  for (let i = 0; i < 16; i++) {
    await sleep(500);
    log = (await api('/api/admin/kitchen/settings')).data.log.filter(l => l.ref === ref);
    if (done(log)) break;
  }
  return log;
};
const orderRow = async ref => (await api(`/api/admin/food-orders?show=list&q=${ref}`)).data.orders[0];
const tg = (body, secret = TG_SECRET) => fetch(`${BASE}/api/telegram/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret }, body: JSON.stringify(body) });
const press = (ref, chat = CHAT, name = 'Ada') => tg({ update_id: 1, callback_query: { id: uid(), from: { id: 5, first_name: name }, data: `ack:${ref}`, message: { message_id: 10, chat: { id: Number(chat) }, text: `NEW PAID ORDER ${ref}` } } });

test('kitchen ticket: items, note, first name, place and time; never phone numbers, totals or payment details', () => {
  const o = { ref: 'FD-20261011-0042', customer_name: 'Emeka Okafor', phone: '+2348031234567', total_kobo: 330000, paid_reference: 'PSK_123', notes: 'No pepper', seat: 'C14', stand: 'Cover Stand', fulfilment: 'seat', paid_iso: new Date(Date.now() - 6 * 60000).toISOString(),
    items_json: JSON.stringify([{ name: 'Beef Suya', qty: 2, priceKobo: 150000 }, { name: 'Bottled Water', qty: 1, priceKobo: 30000 }]) };
  const t = buildKitchenTicket(o);
  assert.equal(t.title, '🍽️ NEW PAID ORDER FD-20261011-0042');
  assert.equal(t.body, '2× Beef Suya, 1× Bottled Water | Seat C14, Cover Stand');
  for (const line of ['2× Beef Suya', '📝 Note: No pepper', '👤 Emeka', '📍 Seat C14, Cover Stand', '🕒 Paid']) assert.ok(t.longText.includes(line), line);
  const all = JSON.stringify(t);
  for (const secret of ['0803', '+234', '3,300', '3300', '1500', 'PSK_123', 'Okafor', '₦']) assert.ok(!all.includes(secret), `no ${secret}`);
  assert.match(buildKitchenTicket(o, 'repeat').title, /^⚠️ STILL WAITING: FD-20261011-0042 \(paid 6 min ago\)$/);
  assert.equal(buildKitchenTicket(o, 'cancel').title, '❌ ORDER FD-20261011-0042 CANCELLED, do not cook');
  assert.match(buildKitchenTicket({ ...o, fulfilment: 'pickup', pickup_point: 'East Gate Kiosk' }).body, /\| Pickup: East Gate Kiosk$/);
});

test('paid order: alerted once (push + Telegram logged), even if marked paid twice; shown on the Kitchen Screen without private details', async () => {
  const o = await paidOrder();
  assert.equal((await api('/api/admin/food-orders', 'POST', { id: o.id, status: 'PAID' })).status, 409, 'already paid');
  const log = await logFor(o.ref);
  assert.equal(log.filter(l => l.attempt === 'initial' && l.channel === 'push').length, 1);
  assert.equal(log.filter(l => l.attempt === 'initial' && l.channel === 'telegram').length, 1);
  const board = (await api('/api/admin/kitchen/orders')).data;
  const k = board.orders.find(x => x.ref === o.ref);
  assert.equal(k.status, 'PAID');
  assert.equal(k.firstName, 'Ada');
  assert.deepEqual(k.items, [{ name: 'Beef Suya', qty: 2 }, { name: 'Bottled Water', qty: 1 }]);
  assert.ok(!('phone' in k) && !('totalKobo' in k) && !JSON.stringify(k).includes('0803'), 'no phone or total');
  const row = await orderRow(o.ref);
  assert.match(row.kitchen.text, /^Alerted \d\d:\d\d$/);
});

test('Kitchen Screen: ACCEPT -> START COOKING -> MARK READY, exact moves only; accepting stops repeats', async () => {
  const o = await paidOrder();
  assert.equal((await api(`/api/admin/kitchen/orders/${o.ref}/ready`, 'POST')).status, 409, 'not ready before cooking');
  assert.equal((await api(`/api/admin/kitchen/orders/${o.ref}/accept`, 'POST')).status, 200);
  assert.equal((await api(`/api/admin/kitchen/orders/${o.ref}/accept`, 'POST')).status, 409, 'accepted only once');
  let row = await orderRow(o.ref);
  assert.equal(row.status, 'ACCEPTED');
  assert.match(row.kitchen.text, /^Accepted by Owner \(admin code\) at \d\d:\d\d$/);
  assert.equal((await api(`/api/admin/kitchen/orders/${o.ref}/preparing`, 'POST')).status, 200);
  assert.equal((await api(`/api/admin/kitchen/orders/${o.ref}/ready`, 'POST')).status, 200);
  row = await orderRow(o.ref);
  assert.equal(row.status, 'OUT_FOR_DELIVERY');
  assert.equal((await api(`/api/admin/kitchen/orders/${o.ref}/nonsense`, 'POST')).status, 404);
  const k = (await api('/api/admin/kitchen/orders')).data.orders.find(x => x.ref === o.ref);
  assert.equal(k.status, 'OUT_FOR_DELIVERY', 'ready orders stay on the board for 15 minutes');
});

test('repeat alerts: only with the cron secret, until accepted, at most the maximum', async () => {
  await api('/api/admin/kitchen/settings', 'POST', { settings: { enabled: true, telegram: false, repeatMinutes: 1, maxRepeats: 2 } });
  const o = await paidOrder();
  const cron = (q = '?olderThanSeconds=0', secret = CRON) => fetch(`${BASE}/api/internal/kitchen-repeat${q}`, { method: 'POST', headers: { Authorization: `Bearer ${secret}` } }).then(r => r.json().then(d => ({ status: r.status, data: d })));
  assert.equal((await cron('', 'wrong')).status, 403);
  for (let i = 0; i < 4; i++) await cron();
  let log = await logFor(o.ref);
  assert.equal(log.filter(l => l.attempt === 'repeat' && l.channel === 'push').length, 2, 'stops at the maximum');
  assert.equal(log.filter(l => l.channel === 'telegram' && l.attempt === 'repeat').length, 0, 'Telegram switched off');
  const row = await orderRow(o.ref);
  assert.match(row.kitchen.text, /Not accepted|Alerted/);
  // Accepted orders are never repeated.
  await api('/api/admin/kitchen/settings', 'POST', { settings: { enabled: true, telegram: false, repeatMinutes: 1, maxRepeats: 5 } });
  const o2 = await paidOrder();
  await api(`/api/admin/kitchen/orders/${o2.ref}/accept`, 'POST');
  await cron();
  log = await logFor(o2.ref);
  assert.equal(log.filter(l => l.attempt === 'repeat').length, 0);
  // Resend from the orders list.
  const o3 = await paidOrder();
  const rs = await api('/api/admin/food-orders', 'POST', { action: 'resend_kitchen', id: o3.id });
  assert.equal(rs.data.result.sent, true);
});

test('Telegram Accept button: secret required, kitchen group only, accepts once', async () => {
  await api('/api/admin/kitchen/settings', 'POST', { settings: { enabled: true, telegram: true, repeatMinutes: 3, maxRepeats: 5 } });
  assert.equal((await tg({}, 'wrong')).status, 403, 'needs the webhook secret');
  const o2 = await paidOrder();
  assert.equal((await press(o2.ref, '-999')).status, 200, 'always 200 for Telegram');
  await sleep(800);
  assert.equal((await orderRow(o2.ref)).status, 'PAID', 'other chats are ignored');
  assert.equal((await press(o2.ref, CHAT, 'Chidi')).status, 200);
  await sleep(1200);
  const row = await orderRow(o2.ref);
  assert.equal(row.status, 'ACCEPTED');
  assert.match(row.kitchen.text, /^Accepted by Telegram: Chidi at/);
  assert.equal((await press(o2.ref, CHAT, 'Bola')).status, 200);
  await sleep(800);
  assert.match((await orderRow(o2.ref)).kitchen.text, /Telegram: Chidi/, 'the first person keeps it');
});

test('cancelling an alerted order tells the kitchen; settings validate; Kitchen role sees only the Kitchen Screen', async () => {
  const o = await paidOrder();
  await api('/api/admin/food-orders', 'POST', { id: o.id, status: 'CANCELLED' });
  const isCancel = l => l.attempt === 'cancel' && l.channel === 'push';
  assert.ok((await logFor(o.ref, log => log.some(isCancel))).some(isCancel));
  assert.equal((await api('/api/admin/kitchen/settings', 'POST', { settings: { enabled: true, telegram: true, repeatMinutes: 0, maxRepeats: 5 } })).status, 400);
  assert.equal((await api('/api/admin/kitchen/settings', 'POST', { settings: { enabled: true, telegram: true, repeatMinutes: 3, maxRepeats: 99 } })).status, 400);

  const login = async role => {
    const email = `k-${role}-${uid()}@example.com`;
    const r = await api('/api/admin/staff', 'POST', { name: `K ${role}`, email, password: 'Role-Test-2026!', role });
    made.push(r.data.id);
    const l = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
    return { Cookie: l.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' };
  };
  const kitchen = await login('kitchen');
  assert.equal((await fetch(`${BASE}/admin/kitchen/`, { headers: kitchen, redirect: 'manual' })).status, 200);
  assert.equal((await fetch(`${BASE}/admin/food-orders/`, { headers: kitchen, redirect: 'manual' })).status, 403);
  assert.equal((await api('/api/admin/kitchen/orders', 'GET', null, kitchen)).status, 200);
  assert.equal((await api('/api/admin/food-orders?show=board', 'GET', null, kitchen)).status, 403, 'no customer details');
  assert.equal((await api('/api/admin/kitchen/settings', 'POST', { settings: { enabled: false, telegram: false, repeatMinutes: 3, maxRepeats: 5 } }, kitchen)).status, 403, 'cannot switch alerts off');
  const o2 = await paidOrder();
  assert.equal((await api(`/api/admin/kitchen/orders/${o2.ref}/accept`, 'POST', null, kitchen)).status, 200, 'the cook can accept');
  const analyst = await login('broadcast_operator');
  assert.equal((await api('/api/admin/kitchen/orders', 'GET', null, analyst)).status, 403);
  assert.equal((await fetch(`${BASE}/api/telegram/webhook`, { method: 'POST', body: '{}' })).status, 403, 'webhook needs the secret');
  const m = await fetch(`${BASE}/kitchen.webmanifest`).then(r => r.json());
  assert.equal(m.name, 'Lobi Stars Kitchen');
  assert.equal(m.start_url, '/admin/kitchen/');
});
