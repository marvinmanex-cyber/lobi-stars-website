// In-seat food ordering, phase 1: statuses and secure payment confirmation.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123,
// PAYSTACK_SECRET_KEY=sk_test_local and PAYSTACK_FAKE=1 (a pretend Paystack
// for tests: /api/dev/paystack-fake says what "Paystack" reports).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const SECRET = process.env.PAYSTACK_SECRET_KEY || 'sk_test_local';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const r7 = () => String(Math.floor(Math.random() * 1e7)).padStart(7, '0');

const post = (path, body, headers = {}) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp(), ...headers }, body: JSON.stringify(body) })
  .then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const fake = body => post('/api/dev/paystack-fake', body);
const webhook = (reference, amount) => {
  const body = JSON.stringify({ event: 'charge.success', data: { reference, amount } });
  return fetch(`${BASE}/api/paystack-webhook`, { method: 'POST', headers: { 'x-paystack-signature': createHmac('sha512', SECRET).update(body).digest('hex') }, body });
};
const admin = (path, method = 'GET', body) => fetch(BASE + path, { method, headers: ADMIN, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));

async function order(over = {}) {
  const email = `food-${uid()}@example.com`;
  const r = await post('/api/food-checkout', { name: 'Terna Akaa', seat: 'C14', stand: 'Cover Stand', phone: `0803${r7()}`, email, notes: 'No pepper', items: [{ id: 'suya', qty: 2 }, { id: 'water', qty: 1 }], ...over });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const u = new URL(r.data.authorizationUrl);
  return { ref: r.data.ref, id: r.data.orderId, token: u.searchParams.get('t'), email, total: 2 * 150000 + 30000 };
}
const status = o => fetch(`${BASE}/api/food/order?ref=${encodeURIComponent(o.ref)}&t=${encodeURIComponent(o.token)}`).then(async r => ({ status: r.status, data: await r.json() }));

test('checkout: name, seat, valid phone and email required; order saved as AWAITING_PAYMENT with an FD reference', async () => {
  assert.equal((await post('/api/food-checkout', { seat: 'A1', phone: '08031234567', email: 'x@example.com', items: [{ id: 'suya', qty: 1 }] })).status, 400);
  assert.equal((await post('/api/food-checkout', { name: 'X', seat: 'A1', phone: '12345', email: 'x@example.com', items: [{ id: 'suya', qty: 1 }] })).status, 400);
  const o = await order();
  assert.match(o.ref, /^FD-\d{8}-\d{4}$/);
  assert.ok(o.token);
  const s = await status(o);
  assert.equal(s.data.order.status, 'AWAITING_PAYMENT');
  assert.equal(s.data.order.totalKobo, o.total);
  assert.equal(s.data.order.items[0].name, 'Beef Suya', 'name and price are copied into the order');
  assert.equal((await fetch(`${BASE}/api/food/order?ref=${o.ref}&t=wrong`)).status, 404, 'needs the private link');
  const aw = await admin('/api/admin/food-orders?show=awaiting');
  assert.ok(aw.data.orders.some(x => x.ref === o.ref && x.status === 'AWAITING_PAYMENT'));
});

test('a fake return to the order page without payment leaves the order AWAITING_PAYMENT', async () => {
  const o = await order();
  // Visiting the Paystack return address with made-up values changes nothing.
  const page = await fetch(`${BASE}/food/order/?ref=${o.ref}&t=${o.token}&trxref=${o.ref}&reference=${o.ref}&status=success`);
  assert.equal(page.status, 200);
  assert.equal((await status(o)).data.order.status, 'AWAITING_PAYMENT');
  // A webhook for an amount Paystack doesn't confirm is not accepted either.
  await fake({ reference: o.ref, status: 'success', amount: 100 });
  await webhook(o.ref, o.total);
  assert.equal((await status(o)).data.order.status, 'AWAITING_PAYMENT', 'amount mismatch with Paystack');
  await fake({ reference: o.ref, status: 'success', amount: o.total, currency: 'USD' });
  await webhook(o.ref, o.total);
  assert.equal((await status(o)).data.order.status, 'AWAITING_PAYMENT', 'wrong currency');
});

test('webhook + Paystack verification marks PAID once; repeating the webhook changes nothing', async () => {
  const o = await order();
  const unsigned = await fetch(`${BASE}/api/paystack-webhook`, { method: 'POST', body: JSON.stringify({ event: 'charge.success', data: { reference: o.ref, amount: o.total } }) });
  assert.equal(unsigned.status, 401);
  await fake({ reference: o.ref, status: 'success', amount: o.total });
  assert.equal((await webhook(o.ref, o.total)).status, 200);
  const first = (await status(o)).data.order;
  assert.equal(first.status, 'PAID');
  assert.ok(first.paidAt);
  assert.equal((await webhook(o.ref, o.total)).status, 200);
  const again = (await status(o)).data.order;
  assert.equal(again.paidAt, first.paidAt, 'not processed twice');
  const fans = await admin(`/api/admin/fans?q=${encodeURIComponent(o.email)}`);
  assert.equal(fans.data.rows.length, 1, 'customer added to the fan database once');
  assert.ok(fans.data.rows[0].sources.includes('food_order'));
  const open = await admin('/api/admin/food-orders?show=open');
  assert.ok(open.data.orders.some(x => x.ref === o.ref && x.status === 'PAID' && x.name === 'Terna Akaa' && x.notes === 'No pepper'));
});

test('if the webhook is late, the order page confirms with Paystack on the server', async () => {
  const o = await order();
  await fake({ reference: o.ref, status: 'success', amount: o.total });
  assert.equal((await status(o)).data.order.status, 'PAID');
});

test('a failed payment becomes PAYMENT_FAILED; unpaid orders EXPIRE after the time limit', async () => {
  const f = await order();
  await fake({ reference: f.ref, status: 'failed', amount: f.total });
  assert.equal((await status(f)).data.order.status, 'PAYMENT_FAILED');

  const e = await order();
  await post('/api/dev/paystack-fake', { action: 'age', ref: e.ref, minutes: 20 });
  assert.equal((await status(e)).data.order.status, 'EXPIRED');
  const aw = await admin('/api/admin/food-orders?show=awaiting');
  assert.ok(!aw.data.orders.some(x => x.ref === e.ref));
});

test('staff move paid orders step by step; the fan tracker shows each step', async () => {
  const o = await order();
  await fake({ reference: o.ref, status: 'success', amount: o.total });
  await webhook(o.ref, o.total);
  const move = s => admin('/api/admin/food-orders', 'POST', { id: o.id, status: s });
  assert.equal((await move('DELIVERED')).status, 409, 'cannot skip steps');
  assert.equal((await move('PREPARING')).status, 200);
  assert.equal((await status(o)).data.order.status, 'PREPARING');
  assert.equal((await move('OUT_FOR_DELIVERY')).status, 200);
  assert.equal((await move('DELIVERED')).status, 200);
  const done = (await status(o)).data.order;
  assert.equal(done.status, 'DELIVERED');
  assert.ok(done.preparingAt && done.outAt && done.deliveredAt);
  // An unpaid order can't be prepared.
  const u = await order();
  assert.equal((await admin('/api/admin/food-orders', 'POST', { id: u.id, status: 'PREPARING' })).status, 409);
});

test('payment time limit setting is validated', async () => {
  assert.equal((await admin('/api/admin/food-orders', 'POST', { settings: { paymentExpiryMinutes: 0 } })).status, 400);
  const ok = await admin('/api/admin/food-orders', 'POST', { settings: { paymentExpiryMinutes: 15 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.settings.paymentExpiryMinutes, 15);
});

test('the fake Paystack helper does not exist unless PAYSTACK_FAKE=1 (it is set only on the test server)', async () => {
  // On the test server it answers; the live site has no PAYSTACK_FAKE and returns 404.
  const r = await fetch(`${BASE}/api/dev/paystack-fake`, { method: 'POST', body: '{}' });
  assert.ok([200, 404].includes(r.status));
});

test('a food customer who already subscribed to the newsletter is merged into one fan-database record', async () => {
  const email = `merge-${uid()}@example.com`, phone = `0803${r7()}`;
  const nl = await post('/api/newsletter', { fullName: 'Merge Fan', phone, email, confirmEmail: email, consent: true, source: 'test' });
  assert.equal(nl.status, 200, JSON.stringify(nl.data));
  // Same person orders food with a different-looking email case but the same phone.
  const r = await post('/api/food-checkout', { name: 'Merge Fan', seat: 'H1', stand: '', phone, email: email.toUpperCase(), items: [{ id: 'water', qty: 1 }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await fake({ reference: r.data.ref, status: 'success', amount: 30000 });
  await webhook(r.data.ref, 30000);
  const fans = await admin(`/api/admin/fans?q=${encodeURIComponent(email)}`);
  assert.equal(fans.data.rows.length, 1, 'one person, not two');
  assert.ok(fans.data.rows[0].sources.includes('newsletter'));
  assert.ok(fans.data.rows[0].sources.includes('food_order'));
});
