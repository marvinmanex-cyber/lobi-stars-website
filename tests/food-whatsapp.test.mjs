// Order on WhatsApp: the order is saved with server prices, WhatsApp opens
// with the order message to the club number, staff confirm it, take payment
// and move it through the kitchen. Pickup points, settings, limits and the
// trap field. Needs the local Pages dev server with ADMIN_CODE=test-code-123.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const r7 = () => String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const post = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify(body) })
  .then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const admin = (path, method = 'GET', body) => fetch(BASE + path, { method, headers: ADMIN, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const waSettings = s => admin('/api/admin/food-menu', 'POST', { action: 'whatsapp_settings', settings: { whatsappEnabled: true, whatsappNumber: '0903 039 9416', whatsappExpiryHours: 3, pickupPoints: [], bankDetails: '', ...s } });
const waOrder = over => post('/api/food/whatsapp-order', { name: 'Emeka Okafor', phone: `0803${r7()}`, fulfilment: 'seat', seat: 'C14', stand: 'Cover Stand', notes: 'No pepper please', items: [{ id: 'suya', qty: 2, priceKobo: 1 }, { id: 'water', qty: 1 }], ...over });
const board = () => admin('/api/admin/food-orders?show=board');
const move = (id, status) => admin('/api/admin/food-orders', 'POST', { id, status });

after(async () => { await waSettings({}); await admin('/api/admin/food-menu', 'POST', { action: 'ordering_mode', mode: 'open' }); });

test('the menu offers Order on WhatsApp with the club number', async () => {
  await waSettings({});
  const m = await fetch(`${BASE}/api/food/menu`).then(r => r.json());
  assert.equal(m.whatsapp.number, '2349030399416');
  assert.match(m.whatsapp.display, /^\+234 903 039 9416$/);
});

test('WhatsApp order: checked on the server, prices from the menu, order message and wa.me link', async () => {
  assert.equal((await waOrder({ phone: '12345' })).status, 400, 'valid phone');
  assert.equal((await waOrder({ seat: '' })).status, 400, 'seat needed for seat delivery');
  assert.equal((await waOrder({ name: 'E' })).status, 400, 'name 2+ characters');
  assert.equal((await waOrder({ items: [] })).status, 400);
  assert.equal((await waOrder({ items: [{ id: 'not-on-menu', qty: 1 }] })).status, 400);
  const trap = await waOrder({ name: `Robot ${r7()}`, website: 'http://spam.example' });
  assert.equal(trap.status, 200, 'robots are not told');
  assert.ok(!(await admin(`/api/admin/food-orders?show=list&q=${encodeURIComponent(trap.data.ref)}`)).data.orders.some(o => o.name.startsWith('Robot')), 'nothing saved');

  const r = await waOrder({});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const d = r.data;
  assert.match(d.ref, /^FD-\d{8}-\d{4}$/);
  assert.equal(d.totalKobo, 2 * 150000 + 30000, 'browser prices ignored');
  assert.equal(d.total, '₦3,300');
  for (const line of ['Hello Lobi Stars FC!', `Order: ${d.ref}`, 'Name: Emeka Okafor', '2 × Beef Suya: ₦3,000', 'Total: ₦3,300', 'Seat C14, Cover Stand', 'Note: No pepper please', 'Please confirm my order']) assert.ok(d.message.includes(line), line);
  assert.ok(d.whatsappUrl.startsWith('https://wa.me/2349030399416?text='));
  assert.equal(decodeURIComponent(d.whatsappUrl.split('?text=')[1]), d.message);
  const track = new URL(d.trackUrl);
  const st = await fetch(`${BASE}/api/food/order?ref=${track.searchParams.get('ref')}&t=${track.searchParams.get('t')}`).then(x => x.json());
  assert.equal(st.order.status, 'AWAITING_WHATSAPP');
  assert.equal(st.order.channel, 'whatsapp');

  const b = (await board()).data;
  const o = b.orders.find(x => x.ref === d.ref);
  assert.ok(o, 'on the live board');
  assert.match(o.wa.phone, /^2348/);
  assert.match(o.wa.messages.CONFIRMED, new RegExp(`${d.ref}.*₦3,300`));
  assert.ok(b.today.whatsapp >= 1);
});

test('staff: confirm, payment received (counts as paid), kitchen steps; Paystack orders cannot be marked paid by hand', async () => {
  const d = (await waOrder({})).data;
  const id = (await board()).data.orders.find(x => x.ref === d.ref).id;
  assert.equal((await move(id, 'PREPARING')).status, 409, 'not before payment');
  assert.equal((await move(id, 'CONFIRMED')).status, 200);
  assert.equal((await move(id, 'PAID')).status, 200);
  let o = (await admin(`/api/admin/food-orders?show=list&q=${d.ref}`)).data.orders[0];
  assert.equal(o.status, 'PAID');
  assert.equal(o.payment, 'paid');
  assert.match(o.paystackRef, /WhatsApp: confirmed by/);
  for (const s of ['PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED']) assert.equal((await move(id, s)).status, 200, s);
  o = (await admin(`/api/admin/food-orders?show=list&q=${d.ref}`)).data.orders[0];
  assert.equal(o.status, 'DELIVERED');

  const pay = await post('/api/food-checkout', { name: 'Pay Fan', seat: 'A1', phone: `0803${r7()}`, email: 'pay@example.com', items: [{ id: 'water', qty: 1 }] });
  assert.equal((await move(pay.data.orderId, 'PAID')).status, 409, 'Paystack orders are only paid when Paystack confirms');
  const c = (await waOrder({})).data;
  const cid = (await board()).data.orders.find(x => x.ref === c.ref).id;
  assert.equal((await move(cid, 'CANCELLED')).status, 200);
});

test('pickup points and bank details from the settings', async () => {
  assert.equal((await waOrder({ fulfilment: 'pickup', pickupPoint: 'Main Stand Kiosk' })).status, 400, 'no pickup points yet');
  assert.equal((await waSettings({ whatsappNumber: '12' })).status, 400, 'valid club number');
  await waSettings({ pickupPoints: ['Main Stand Kiosk', 'East Gate Kiosk'], bankDetails: 'Lobi Stars FC, Test Bank, 0123456789', msgReady: 'Hi {name}, {ref} is ready at {pickup}!' });
  const m = await fetch(`${BASE}/api/food/menu`).then(r => r.json());
  assert.deepEqual(m.pickupPoints, ['Main Stand Kiosk', 'East Gate Kiosk']);
  assert.equal((await waOrder({ fulfilment: 'pickup', pickupPoint: 'Somewhere else' })).status, 400);
  const r = await waOrder({ fulfilment: 'pickup', pickupPoint: 'East Gate Kiosk', seat: '' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.message.includes('Pickup: East Gate Kiosk'));
  const o = (await board()).data.orders.find(x => x.ref === r.data.ref);
  assert.equal(o.fulfilment, 'pickup');
  assert.match(o.wa.messages.CONFIRMED, /Test Bank, 0123456789/);
  assert.equal(o.wa.messages.READY, `Hi Emeka, ${r.data.ref} is ready at East Gate Kiosk!`);
  // Paystack checkout can be collected too.
  const p = await post('/api/food-checkout', { name: 'Pick Up', fulfilment: 'pickup', pickupPoint: 'Main Stand Kiosk', phone: `0803${r7()}`, email: 'pick@example.com', items: [{ id: 'water', qty: 1 }] });
  assert.equal(p.status, 200, JSON.stringify(p.data));
});

test('limits: 5 orders per phone in 30 minutes; switched off or closed ordering', async () => {
  const phone = `0803${r7()}`;
  for (let i = 0; i < 5; i++) assert.equal((await waOrder({ phone })).status, 200, `order ${i + 1}`);
  const sixth = await waOrder({ phone });
  assert.equal(sixth.status, 429);
  assert.match(sixth.data.error, /30 minutes/);
  await waSettings({ whatsappEnabled: false });
  assert.equal((await fetch(`${BASE}/api/food/menu`).then(r => r.json())).whatsapp, null);
  assert.equal((await waOrder({})).status, 503);
  await waSettings({});
  await admin('/api/admin/food-menu', 'POST', { action: 'ordering_mode', mode: 'closed' });
  const closed = await waOrder({});
  assert.equal(closed.status, 503);
  assert.equal(closed.data.code, 'closed');
  await admin('/api/admin/food-menu', 'POST', { action: 'ordering_mode', mode: 'open' });
});
