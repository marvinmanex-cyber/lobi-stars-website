// In-seat food menu management (Admin -> In-Seat Food -> Menu).
// Needs the local Pages dev server with ADMIN_CODE=test-code-123 and PAYSTACK_FAKE=1.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 7);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const r7 = () => String(Math.floor(Math.random() * 1e7)).padStart(7, '0');

const menuApi = body => fetch(`${BASE}/api/admin/food-menu`, { method: body ? 'POST' : 'GET', headers: ADMIN, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const pub = () => fetch(`${BASE}/api/food/menu`).then(r => r.json());
const pubItem = async id => (await pub()).categories.flatMap(c => c.items).find(i => i.id === id);
const checkout = (items, over = {}) => fetch(`${BASE}/api/food-checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ name: 'Menu Tester', seat: 'B2', stand: '', phone: `0803${r7()}`, email: `m-${uid()}@example.com`, items, ...over }) }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const created = [];
async function add(over = {}) {
  const { data: s } = await menuApi();
  const r = await menuApi({ action: 'save', item: { name: `Test Item ${uid()}`, price: 1200, category: s.categories[0].id, emoji: '🧪', ...over } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  created.push(r.data.id);
  return r.data.id;
}
after(async () => {
  for (const id of created) await menuApi({ action: 'delete', id });
  await menuApi({ action: 'settings', settings: { orderingMode: 'open', autoOpenMinutes: 90, paymentExpiryMinutes: 15, minOrder: 0, stands: [] } });
});

test('the original menu items were moved into the menu manager', async () => {
  const { status, data } = await menuApi();
  assert.equal(status, 200);
  for (const id of ['suya', 'pepper', 'chicken', 'water', 'malt', 'puff', 'plantain', 'pie']) assert.ok(data.items.some(i => i.id === id), id);
  assert.ok(data.categories.length >= 3);
  assert.equal((await fetch(`${BASE}/api/admin/food-menu`)).status, 401);
});

test('add an item: validated, shows on the public menu straight away', async () => {
  const { data: s } = await menuApi();
  assert.equal((await menuApi({ action: 'save', item: { name: '', price: 100, category: s.categories[0].id, emoji: '🧪' } })).status, 400);
  assert.equal((await menuApi({ action: 'save', item: { name: 'X', price: 0, category: s.categories[0].id, emoji: '🧪' } })).status, 400);
  assert.equal((await menuApi({ action: 'save', item: { name: 'X', price: 12.5, category: s.categories[0].id, emoji: '🧪' } })).status, 400);
  assert.equal((await menuApi({ action: 'save', item: { name: 'X', price: 100, category: s.categories[0].id } })).status, 400, 'needs a photo or emoji');
  const id = await add({ description: 'Tasty' });
  const p = await pubItem(id);
  assert.ok(p, 'on the public menu');
  assert.equal(p.priceKobo, 120000);
  assert.equal(p.description, 'Tasty');
});

test('photos: only real JPG/PNG/WebP files are accepted, then served from the site', async () => {
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, 1, 2, 3, 4]);
  const up = await fetch(`${BASE}/api/admin/food-photo`, { method: 'POST', headers: { 'Content-Type': 'image/webp', 'x-admin-code': ADMIN['x-admin-code'] }, body: webp }).then(async r => ({ status: r.status, data: await r.json() }));
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const img = await fetch(BASE + up.data.url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/webp');
  const fake = await fetch(`${BASE}/api/admin/food-photo`, { method: 'POST', headers: { 'Content-Type': 'image/webp', 'x-admin-code': ADMIN['x-admin-code'] }, body: 'not an image at all' });
  assert.equal(fake.status, 400);
  const txt = await fetch(`${BASE}/api/admin/food-photo`, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'x-admin-code': ADMIN['x-admin-code'] }, body: 'x' });
  assert.equal(txt.status, 400);
  const id = await add({ photoId: up.data.id });
  assert.equal((await pubItem(id)).photo, up.data.url);
});

test('price change: new orders pay the new price, past orders keep theirs, history records it', async () => {
  const id = await add({ price: 1000 });
  const first = await checkout([{ id, qty: 1 }]);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal((await menuApi({ action: 'price', id, price: 1500 })).status, 200);
  const u = new URL(first.data.authorizationUrl);
  const old = await fetch(`${BASE}/api/food/order?ref=${first.data.ref}&t=${u.searchParams.get('t')}`).then(r => r.json());
  assert.equal(old.order.totalKobo, 100000, 'past order keeps its price');
  const second = await checkout([{ id, qty: 1 }]);
  const u2 = new URL(second.data.authorizationUrl);
  const now = await fetch(`${BASE}/api/food/order?ref=${second.data.ref}&t=${u2.searchParams.get('t')}`).then(r => r.json());
  assert.equal(now.order.totalKobo, 150000);
  const { data } = await menuApi();
  assert.ok(data.items.find(i => i.id === id).history.some(h => /Price changed from ₦1,000 to ₦1,500/.test(h.text)));
});

test('sold out: greyed on the menu and cannot be ordered; stock and per-order limits are enforced', async () => {
  const id = await add();
  await menuApi({ action: 'soldOut', id, value: true });
  assert.equal((await pubItem(id)).soldOut, true);
  assert.equal((await checkout([{ id, qty: 1 }])).status, 409);
  await menuApi({ action: 'soldOut', id, value: false });
  assert.equal((await checkout([{ id, qty: 1 }])).status, 200);

  const lim = await add({ maxPerOrder: 2, stock: 5 });
  assert.equal((await checkout([{ id: lim, qty: 3 }])).status, 400, 'max per order');
  const few = await add({ stock: 1 });
  assert.equal((await checkout([{ id: few, qty: 2 }])).status, 409, 'not enough stock');
});

test('18+ drinks need the age confirmation; minimum order is enforced', async () => {
  const id = await add({ adult: true });
  assert.equal((await pubItem(id)).adult, true);
  const no = await checkout([{ id, qty: 1 }]);
  assert.equal(no.status, 400);
  assert.equal(no.data.code, 'adult');
  assert.equal((await checkout([{ id, qty: 1 }], { adultConfirmed: true })).status, 200);
  await menuApi({ action: 'settings', settings: { orderingMode: 'open', autoOpenMinutes: 90, paymentExpiryMinutes: 15, minOrder: 5000, stands: [] } });
  const small = await add({ price: 500 });
  assert.equal((await checkout([{ id: small, qty: 1 }])).status, 400);
  await menuApi({ action: 'settings', settings: { orderingMode: 'open', autoOpenMinutes: 90, paymentExpiryMinutes: 15, minOrder: 0, stands: [] } });
});

test('delete: never-ordered items are deleted; ordered items are archived and can be restored', async () => {
  const fresh = await add();
  const d = await menuApi({ action: 'delete', id: fresh });
  assert.equal(d.data.deleted, true);
  assert.ok(!d.data.items.some(i => i.id === fresh));
  created.splice(created.indexOf(fresh), 1);

  const ordered = await add();
  assert.equal((await checkout([{ id: ordered, qty: 1 }])).status, 200);
  const a = await menuApi({ action: 'delete', id: ordered });
  assert.equal(a.data.archived, true);
  assert.equal(await pubItem(ordered), undefined, 'hidden from fans');
  assert.ok(a.data.items.find(i => i.id === ordered).archived);
  await menuApi({ action: 'restore', id: ordered });
  assert.ok(await pubItem(ordered));
});

test('duplicate makes a hidden copy; categories can be added, renamed and deleted only when empty', async () => {
  const id = await add();
  const dup = await menuApi({ action: 'duplicate', id });
  created.push(dup.data.id);
  const copy = dup.data.items.find(i => i.id === dup.data.id);
  assert.match(copy.name, /\(copy\)$/);
  assert.equal(copy.available, false);
  assert.equal(await pubItem(dup.data.id), undefined);

  const name = `Cat ${uid()}`;
  const c = await menuApi({ action: 'category-add', name });
  const cat = c.data.categories.find(x => x.name === name);
  assert.ok(cat);
  assert.equal((await menuApi({ action: 'category-rename', id: cat.id, name: name + ' X' })).status, 200);
  const used = (await menuApi()).data.categories.find(x => x.count > 0);
  assert.equal((await menuApi({ action: 'category-delete', id: used.id })).status, 400);
  assert.equal((await menuApi({ action: 'category-delete', id: cat.id })).status, 200);
});

test('ordering closed: the public page says so and orders are refused; stands list is enforced', async () => {
  await menuApi({ action: 'settings', settings: { orderingMode: 'closed', autoOpenMinutes: 90, paymentExpiryMinutes: 15, minOrder: 0, stands: [] } });
  assert.equal((await pub()).open, false);
  const r = await checkout([{ id: 'water', qty: 1 }]);
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'closed');
  await menuApi({ action: 'settings', settings: { orderingMode: 'open', autoOpenMinutes: 90, paymentExpiryMinutes: 15, minOrder: 0, stands: ['Cover Stand', 'VIP'] } });
  assert.deepEqual((await pub()).stands, ['Cover Stand', 'VIP']);
  assert.equal((await checkout([{ id: 'water', qty: 1 }], { stand: 'Somewhere' })).status, 400);
  assert.equal((await checkout([{ id: 'water', qty: 1 }], { stand: 'VIP' })).status, 200);
  assert.equal((await menuApi({ action: 'settings', settings: { orderingMode: 'sometimes' } })).status, 400);
});
