// Receipts for in-seat food: staff send the buyer a MatchDay Kitchen receipt
// on WhatsApp (wa.me to the buyer's number with the receipt link) or by email,
// only for paid orders; the receipt page opens with the private link; the Live
// Order Board opens Notifications / Kitchen Screen in a new tab.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123 (no RESEND_API_KEY).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const r7 = () => String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const post = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify(body) })
  .then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const admin = (path, method = 'GET', body) => fetch(BASE + path, { method, headers: ADMIN, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const waSettings = s => admin('/api/admin/food-menu', 'POST', { action: 'whatsapp_settings', settings: { whatsappEnabled: true, whatsappNumber: '0903 039 9416', whatsappExpiryHours: 3, pickupPoints: [], bankDetails: '', ...s } });
const move = (id, status) => admin('/api/admin/food-orders', 'POST', { id, status });
after(async () => { await waSettings({}); });

test('receipts: only for paid orders; WhatsApp opens a chat with the buyer with the receipt link; the receipt page opens', async () => {
  await waSettings({});
  await admin('/api/admin/food-menu', 'POST', { action: 'ordering_mode', mode: 'open' });
  const phone = `0803${r7()}`;
  const o = await post('/api/food/whatsapp-order', { name: 'Ada Receipt', phone, fulfilment: 'seat', seat: 'B7', stand: 'VIP', items: [{ id: 'suya', qty: 1 }] });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  const order = (await admin('/api/admin/food-orders?show=board')).data.orders.find(x => x.ref === o.data.ref);
  assert.equal((await admin('/api/admin/food-orders', 'POST', { action: 'receipt_whatsapp', id: order.id })).status, 409, 'not paid yet');
  for (const s of ['PAID', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED']) assert.equal((await move(order.id, s)).status, 200, s);

  const wa = await admin('/api/admin/food-orders', 'POST', { action: 'receipt_whatsapp', id: order.id });
  assert.equal(wa.status, 200, JSON.stringify(wa.data));
  assert.ok(wa.data.url.startsWith(`https://wa.me/234${phone.slice(1)}?text=`), 'to the buyer\'s number');
  const text = decodeURIComponent(wa.data.url.split('?text=')[1]);
  assert.match(text, /MatchDay Kitchen/);
  assert.match(text, new RegExp(o.data.ref));
  assert.match(text, /\/food\/receipt\/\?ref=/);
  const after1 = (await admin('/api/admin/food-orders?show=board')).data.orders.find(x => x.id === order.id);
  assert.ok(after1.receipt.whatsappAt, 'recorded on the board');

  // The receipt page and its data (the private link).
  const u = new URL(wa.data.receipt);
  const page = await (await fetch(`${BASE}/food/receipt/${u.search}`)).text();
  assert.match(page, /matchday-kitchen-logo\.png/);
  assert.match(page, /noindex/);
  const data = await fetch(`${BASE}/api/food/order${u.search}`).then(r => r.json());
  assert.equal(data.order.ref, o.data.ref);
  assert.ok(data.order.paidAt && data.order.deliveredAt);

  // Email: an address is needed (WhatsApp orders have none); without the email service it says so plainly.
  const noAddr = await admin('/api/admin/food-orders', 'POST', { action: 'receipt_email', id: order.id });
  assert.equal(noAddr.status, 400);
  assert.equal(noAddr.data.needEmail, true);
  const em = await admin('/api/admin/food-orders', 'POST', { action: 'receipt_email', id: order.id, email: 'ada.receipt@example.com' });
  assert.ok([200, 503].includes(em.status), JSON.stringify(em.data));
  if (em.status === 503) assert.match(em.data.error, /Email is not set up/);
});

test('the Live Order Board opens Notifications, Kitchen Screen and Orders list in a new tab (built page)', () => {
  const html = readFileSync(new URL('../dist/admin/food-orders/live/index.html', import.meta.url), 'utf8');
  for (const href of ['/admin/food-orders/kitchen-alerts/#device', '/admin/kitchen/', '/admin/food-orders/']) assert.ok(html.includes(`href="${href}" target="_blank" rel="noopener"`), href);
});

test('the buyer\'s email is optional (card orders too); a wrong one is still refused', async () => {
  await admin('/api/admin/food-menu', 'POST', { action: 'ordering_mode', mode: 'open' });
  const base = { name: 'No Email', seat: 'C14', stand: 'Cover Stand', phone: `0803${r7()}`, items: [{ id: 'suya', qty: 1 }] };
  const ok = await post('/api/food-checkout', base);
  assert.notEqual(ok.status, 400, JSON.stringify(ok.data));
  assert.ok(ok.data.ref, 'the order is created');
  const bad = await post('/api/food-checkout', { ...base, phone: `0803${r7()}`, email: 'not-an-email' });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /leave it empty/);
});

test('Kitchen Screen: orders coming in but not paid show as "don\'t cook yet"; paid ones go to NEW; live updates address', async () => {
  const o = await post('/api/food/whatsapp-order', { name: 'Kit Coming', phone: `0803${r7()}`, fulfilment: 'seat', seat: 'K9', items: [{ id: 'suya', qty: 1 }] });
  let k = (await admin('/api/admin/kitchen/orders')).data;
  assert.ok(k.coming.some(c => c.ref === o.data.ref && /WhatsApp/.test(c.how)), 'shown as coming, not paid');
  assert.ok(!k.orders.some(x => x.ref === o.data.ref), 'not in NEW yet');
  const id = (await admin('/api/admin/food-orders?show=board')).data.orders.find(x => x.ref === o.data.ref).id;
  await move(id, 'PAID');
  k = (await admin('/api/admin/kitchen/orders')).data;
  assert.ok(k.orders.some(x => x.ref === o.data.ref && x.status === 'PAID'), 'NEW once paid');
  assert.ok(!k.coming.some(c => c.ref === o.data.ref));
  const html = readFileSync(new URL('../dist/admin/kitchen/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('/api/admin/kitchen/stream'), 'live updates');
  await move(id, 'CANCELLED');
});
