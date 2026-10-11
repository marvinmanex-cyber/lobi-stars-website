// In-seat food, phase 4: food analytics, dashboard card, food customers in the fan database.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123,
// PAYSTACK_SECRET_KEY=sk_test_local and PAYSTACK_FAKE=1.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const SECRET = process.env.PAYSTACK_SECRET_KEY || 'sk_test_local';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const r7 = () => String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const admin = (path, headers = ADMIN) => fetch(BASE + path, { headers }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const made = [];
after(async () => { for (const id of made) await fetch(`${BASE}/api/admin/staff/${id}`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ active: false }) }); });

async function order(items, email = `fa-${uid()}@example.com`) {
  const r = await fetch(`${BASE}/api/food-checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ name: 'Analytics Fan', seat: 'G3', stand: 'Analytics Stand', phone: `0803${r7()}`, email, items }) }).then(r => r.json());
  assert.ok(r.ref, JSON.stringify(r));
  return { ref: r.ref, id: r.orderId, email };
}
async function pay(o, total) {
  await fetch(`${BASE}/api/dev/paystack-fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference: o.ref, status: 'success', amount: total }) });
  const body = JSON.stringify({ event: 'charge.success', data: { reference: o.ref, amount: total } });
  await fetch(`${BASE}/api/paystack-webhook`, { method: 'POST', headers: { 'x-paystack-signature': createHmac('sha512', SECRET).update(body).digest('hex') }, body });
}
async function staff(role, canExport = false) {
  const email = `fa-${role}-${uid()}@example.com`;
  const r = await fetch(`${BASE}/api/admin/staff`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ name: `FA ${role}`, email, password: 'Role-Test-2026!', role, canExport }) }).then(r => r.json());
  made.push(r.id);
  const login = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
  return { Cookie: login.headers.get('set-cookie').split(';')[0] };
}

test('only paid orders are counted; item percentages add up to 100', async () => {
  const before = (await admin('/api/admin/food-analytics?range=all')).data;
  const unpaid = await order([{ id: 'pie', qty: 3 }]);
  const mid = (await admin('/api/admin/food-analytics?range=all')).data;
  assert.equal(mid.kpis.paidOrders, before.kpis.paidOrders, 'an unpaid order is not counted');
  assert.equal(mid.kpis.ordersCreated, before.kpis.ordersCreated + 1, 'but it counts towards conversion');
  await pay(unpaid, 3 * 70000);
  const now = (await admin('/api/admin/food-analytics?range=all')).data;
  assert.equal(now.kpis.paidOrders, before.kpis.paidOrders + 1);
  const pieB = before.items.find(i => i.id === 'pie')?.qty || 0;
  assert.equal(now.items.find(i => i.id === 'pie').qty, pieB + 3);
  const sum = Math.round(now.items.reduce((s, i) => s + i.qtyPct, 0) * 10) / 10;
  assert.equal(sum, 100);
  assert.ok(now.favourite && now.favourite.qty === now.items[0].qty);
  assert.ok(now.categories.length >= 1);
  assert.ok(now.stands.some(s => s.stand === 'Analytics Stand'));
  assert.ok(now.timeline.length > 0);
  assert.ok(now.kpis.conversionPct > 0 && now.kpis.conversionPct <= 100);
});

test('exports: Food Report and Customers are real Excel files, only for staff allowed to export', async () => {
  for (const f of ['report', 'customers']) {
    const r = await fetch(`${BASE}/api/admin/food-analytics?range=all&format=${f}`, { headers: ADMIN });
    assert.equal(r.status, 200);
    const b = new Uint8Array(await r.arrayBuffer());
    assert.equal(String.fromCharCode(b[0], b[1]), 'PK');
  }
  const analyst = await staff('analyst');
  assert.equal((await admin('/api/admin/food-analytics?range=all', analyst)).status, 200, 'analysts can see food analytics');
  assert.equal((await fetch(`${BASE}/api/admin/food-analytics?format=customers`, { headers: analyst })).status, 403, 'but cannot download customers');
  assert.equal((await fetch(`${BASE}/admin/food-orders/analytics/`, { headers: analyst, redirect: 'manual' })).status, 200);
  const fr = await staff('fan_relations');
  assert.equal((await admin('/api/admin/food-analytics', fr)).status, 403);
});

test('food customers join the fan database with their food order history; dashboard shows today\'s food', async () => {
  const o = await order([{ id: 'water', qty: 1 }]);
  await pay(o, 30000);
  const list = (await admin(`/api/admin/fans?q=${encodeURIComponent(o.email)}`)).data;
  assert.equal(list.rows.length, 1);
  assert.ok(list.rows[0].sources.includes('food_order'));
  const profile = (await admin(`/api/admin/fans/${list.rows[0].id}`)).data;
  assert.equal(profile.foodOrders.length, 1);
  assert.equal(profile.foodOrders[0].ref, o.ref);
  const dash = (await admin('/api/admin/dashboard')).data;
  assert.ok(dash.food && dash.food.orders >= 1);
});
