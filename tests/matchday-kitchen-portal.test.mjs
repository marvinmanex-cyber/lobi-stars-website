// MatchDay Kitchen staff area (/matchday-kitchen): its own staff and sign-in,
// never the admin back end; the kitchen screen changes the website's real
// orders, the menu page the real menu; roles; everything in the activity log;
// switching someone off signs them out; lockout; private pages.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './media-helpers.mjs';
import { hashPassword } from '../functions/api/_lib/password.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const T = Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z]/g, 'Q');
const SA_EMAIL = `mk-sa-${T.toLowerCase()}@example.com`, SA_PW = 'Kitchen-Super-2026!';
const COOK = { staffId: `LSK-${T}1`, name: 'Ada Cook', role: 'cook', password: 'Grill-Fire-77' };
const SUP = { staffId: `LSK-${T}2`, name: 'Bola Super', role: 'supervisor', password: 'Pepper-Soup-88' };
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const rows = q => JSON.parse(sql(q))[0].results;
let suya;

async function signIn(login, password, extra = {}) {
  const r = await fetch(`${BASE}/api/matchday-kitchen/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ login, password, ...extra }) });
  const cookie = (r.headers.get('set-cookie') || '').match(/ls_mdk=([^;]+)/)?.[1];
  return { status: r.status, data: await r.json().catch(() => ({})), cookie };
}
async function as(cookie) {
  const s = await fetch(`${BASE}/api/matchday-kitchen/session`, { headers: { Cookie: `ls_mdk=${cookie}` } }).then(r => r.json());
  const call = (path, body) => fetch(`${BASE}/api/matchday-kitchen/${path}`, body ? { method: 'POST', headers: { Cookie: `ls_mdk=${cookie}`, 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf }, body: JSON.stringify(body) } : { headers: { Cookie: `ls_mdk=${cookie}` } })
    .then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
  return { s, call };
}

after(() => {
  if (suya) sql(`UPDATE food_items SET price_kobo = ${suya.price_kobo}, sold_out = ${suya.sold_out} WHERE id = 'suya';`);
  sql(`DELETE FROM admin_users WHERE email = '${SA_EMAIL}';`);
});

test('Super Admin signs in with the website email; kitchen staff with their Staff ID; neither opens /admin', async () => {
  sql(`INSERT INTO admin_users (id, name, email, password_hash, role, active, test_account) VALUES ('mkt_${T}', 'Kitchen Super Tester', '${SA_EMAIL}', '${await hashPassword(SA_PW)}', 'super_admin', 1, 1);`);
  const sa = await signIn(SA_EMAIL.toUpperCase(), SA_PW);
  assert.equal(sa.status, 200, JSON.stringify(sa.data)); assert.ok(sa.cookie);
  const A = await as(sa.cookie);
  assert.equal(A.s.user.kind, 'admin'); assert.equal(A.s.perms.staff, true);
  // The kitchen cookie never opens the admin back end.
  assert.equal((await fetch(`${BASE}/api/admin/me`, { headers: { Cookie: `ls_mdk=${sa.cookie}` } })).status, 401);
  for (const p of [COOK, SUP]) assert.equal((await A.call('staff', { action: 'add', ...p, staffId: p.staffId.toLowerCase() })).status, 200, `adds ${p.name} (ID saved in capitals)`);
  assert.equal((await A.call('staff', { action: 'add', ...COOK, name: 'Someone Else' })).status, 400, 'Staff IDs are unique');
  assert.match((await A.call('staff', { action: 'add', staffId: `LSK-${T}9`, name: 'Weak Pw', role: 'cook', password: '12345678' })).data.error, /only numbers|common/);
  const list = (await A.call('staff')).data.staff;
  assert.ok(list.some(s => s.staffId === COOK.staffId && s.role === 'cook'));

  const cook = await signIn(COOK.staffId.toLowerCase(), COOK.password);
  assert.equal(cook.status, 200, JSON.stringify(cook.data));
  assert.equal((await fetch(`${BASE}/api/admin/me`, { headers: { Cookie: `ls_mdk=${cook.cookie}` } })).status, 401, 'kitchen staff cannot open /admin');
  const C = await as(cook.cookie);
  assert.equal(C.s.user.code, COOK.staffId); assert.equal(C.s.perms.price, false); assert.equal(C.s.perms.cancel, false);
  assert.equal((await C.call('staff')).status, 403, 'only Super Admins manage staff');
  // A non-Super-Admin website account cannot sign in with an email.
  assert.equal((await signIn('nobody-here@example.com', 'whatever-123')).status, 401);
});

test('the kitchen screen moves the real order; the menu page changes the real menu; roles are enforced; all recorded', async () => {
  const sa = await signIn(SA_EMAIL, SA_PW), A = await as(sa.cookie);
  const cook = await signIn(COOK.staffId, COOK.password), C = await as(cook.cookie);
  const sup = await signIn(SUP.staffId, SUP.password), S = await as(sup.cookie);
  // A WhatsApp order, confirmed as paid: it is now New on the kitchen screen.
  const o = await fetch(`${BASE}/api/food/whatsapp-order`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ name: 'Kitchen Fan', phone: `0803${String(Math.random()).slice(2, 9)}`, fulfilment: 'seat', seat: 'K12', notes: 'No pepper', items: [{ id: 'suya', qty: 2 }] }) }).then(r => r.json());
  assert.ok(o.ref, JSON.stringify(o));
  const id = rows(`SELECT id FROM food_orders WHERE ref = '${o.ref}';`)[0].id;
  assert.equal((await C.call('order', { id, to: 'CANCELLED' })).status, 403, 'a cook cannot cancel');
  assert.equal((await S.call('order', { id, to: 'PAID' })).status, 200);
  let k = (await C.call('kitchen')).data.tickets.find(t => t.ref === o.ref);
  assert.ok(k, 'on the kitchen screen'); assert.equal(k.next.label, 'Accept order'); assert.equal(k.note, 'No pepper'); assert.equal(k.items[0].qty, 2);
  // The alarm: a new (paid, not accepted) order beeps until someone accepts it.
  assert.ok((await C.call('pulse')).data.newOrders.some(p => p.ref === o.ref), 'new order alarm');
  assert.equal((await C.call('order', { id, to: k.next.to })).status, 200);
  assert.ok(!(await C.call('pulse')).data.newOrders.some(p => p.ref === o.ref), 'accepting stops the alarm');
  k = (await C.call('kitchen')).data.tickets.find(t => t.ref === o.ref);
  assert.equal(k.statusLabel, 'Received'); assert.equal(k.next.label, 'Start cooking');
  assert.equal((await C.call('order', { id, to: k.next.to })).status, 200);
  k = (await C.call('kitchen')).data.tickets.find(t => t.ref === o.ref);
  assert.equal(k.statusLabel, 'Preparing'); assert.equal(k.next.label, 'Food on the way');
  assert.equal((await C.call('order', { id, to: k.next.to })).status, 200);
  assert.equal(rows(`SELECT order_status FROM food_orders WHERE id = '${id}';`)[0].order_status, 'OUT_FOR_DELIVERY', "the website's real order is Ready");
  const board = (await C.call('board')).data.columns;
  assert.ok(board.ready.orders.some(t => t.ref === o.ref), 'in the On the way column');
  // Late: not delivered within 5 minutes of payment.
  rows(`UPDATE food_orders SET paid_iso = '${new Date(Date.now() - 10 * 60e3).toISOString()}' WHERE id = '${id}';`);
  const pl = (await C.call('pulse')).data;
  assert.equal(pl.lateMinutes, 5); assert.ok(pl.late.some(p => p.ref === o.ref), 'late order alarm');
  // Delivered: the receipt (no email on this order, so WhatsApp, one tap).
  k = (await C.call('kitchen')).data.tickets.find(t => t.ref === o.ref);
  assert.equal(k.next.label, 'Mark delivered');
  const dl = await C.call('order', { id, to: k.next.to });
  assert.equal(dl.status, 200); assert.match(dl.data.receipt.whatsappUrl, /^https:\/\/wa\.me\/234\d+\?text=/);
  assert.ok(!(await C.call('pulse')).data.late.some(p => p.ref === o.ref), 'delivered: no longer late');
  assert.equal((await C.call('receipt', { id, via: 'whatsapp' })).status, 200);
  assert.ok(rows(`SELECT receipt_wa_at FROM food_orders WHERE id = '${id}';`)[0].receipt_wa_at, 'WhatsApp receipt recorded');

  // Menu: anyone can mark sold out; only supervisors (and Super Admins) change prices.
  suya = rows(`SELECT price_kobo, sold_out FROM food_items WHERE id = 'suya';`)[0];
  assert.equal((await C.call('menu', { id: 'suya', action: 'soldout' })).status, 200);
  assert.equal(rows(`SELECT sold_out FROM food_items WHERE id = 'suya';`)[0].sold_out, 1, 'sold out on the website menu');
  assert.equal((await C.call('menu', { id: 'suya', action: 'back' })).status, 200);
  assert.equal(rows(`SELECT sold_out FROM food_items WHERE id = 'suya';`)[0].sold_out, 0);
  assert.equal((await C.call('menu', { id: 'suya', action: 'price', price: '2000' })).status, 403, 'a cook cannot change prices');
  assert.equal((await S.call('menu', { id: 'suya', action: 'price', price: 'abc' })).data.error, 'Enter the price as a number, e.g. 2500.');
  assert.equal((await S.call('menu', { id: 'suya', action: 'price', price: '-5' })).status, 400);
  assert.equal((await S.call('menu', { id: 'suya', action: 'price', price: '1650' })).status, 200);
  assert.equal(rows(`SELECT price_kobo FROM food_items WHERE id = 'suya';`)[0].price_kobo, 165000);

  // Activity log: everyone's for the Super Admin (and CSV); only their own for staff.
  const all = (await A.call('activity')).data;
  assert.ok(all.rows.some(a => a.code === COOK.staffId && a.action === `Order ${o.ref}: Preparing to On the way`), 'status change under the cook');
  assert.ok(all.rows.some(a => a.code === COOK.staffId && a.action === 'Marked Suya as sold out' || /sold out/.test(a.action)));
  assert.ok(all.rows.some(a => a.code === SUP.staffId && /^Changed the price of .+ to ₦1,650$/.test(a.action)));
  const mine = (await C.call('activity')).data;
  assert.ok(mine.rows.length && mine.rows.every(a => a.code === COOK.staffId), 'staff see only their own');
  const csv = await fetch(`${BASE}/api/matchday-kitchen/activity?format=csv`, { headers: { Cookie: `ls_mdk=${sa.cookie}` } });
  assert.equal(csv.status, 200); assert.match(await csv.text(), /What happened/);
  assert.equal((await fetch(`${BASE}/api/matchday-kitchen/activity?format=csv`, { headers: { Cookie: `ls_mdk=${cook.cookie}` } })).status, 403);
  // Changes need the session token.
  assert.equal((await fetch(`${BASE}/api/matchday-kitchen/menu`, { method: 'POST', headers: { Cookie: `ls_mdk=${cook.cookie}`, 'Content-Type': 'application/json' }, body: '{"id":"suya","action":"soldout"}' })).status, 403);
});

test('shifts, handover notes (pin: supervisors only), switching off signs out at once, lockout after 5 wrong passwords', async () => {
  const cook = await signIn(COOK.staffId, COOK.password), C = await as(cook.cookie);
  const sup = await signIn(SUP.staffId, SUP.password), S = await as(sup.cookie);
  assert.equal((await C.call('shift', { action: 'start' })).status, 200);
  assert.equal((await C.call('shift', { action: 'start' })).status, 409, 'one shift at a time');
  assert.ok((await S.call('shift')).data.onNow.some(p => p.code === COOK.staffId), 'in the kitchen now');
  assert.equal((await C.call('shift', { action: 'end' })).status, 200);
  assert.equal((await C.call('notes', { action: 'add', text: `Jollof running low ${T}` })).status, 200);
  const note = (await C.call('notes')).data.notes.find(n => n.text.includes(T));
  assert.equal((await C.call('notes', { action: 'pin', id: note.id })).status, 403);
  assert.equal((await S.call('notes', { action: 'pin', id: note.id })).status, 200);
  assert.equal((await S.call('notes')).data.notes[0].id, note.id, 'pinned notes first');

  const sa = await signIn(SA_EMAIL, SA_PW), A = await as(sa.cookie);
  const cookRow = (await A.call('staff')).data.staff.find(s => s.staffId === COOK.staffId);
  assert.equal((await A.call('staff', { action: 'edit', id: cookRow.id, active: false })).status, 200);
  assert.equal((await fetch(`${BASE}/api/matchday-kitchen/session`, { headers: { Cookie: `ls_mdk=${cook.cookie}` } })).status, 401, 'signed out on every tablet');
  assert.equal((await signIn(COOK.staffId, COOK.password)).status, 403, 'switched off');
  for (let i = 0; i < 4; i++) assert.equal((await signIn(SUP.staffId, 'wrong-password-x')).status, 401);
  assert.equal((await signIn(SUP.staffId, 'wrong-password-x')).status, 423, 'locked on the 5th');
  assert.equal((await signIn(SUP.staffId, SUP.password)).status, 423, 'still locked with the right password');
  assert.equal((await signIn(`LSK-NOPE${T}`, 'whatever-123')).status, 401, 'unknown Staff ID: same answer');
});

test('pages are private: noindex, strict security headers, only framed by MatchDay Kitchen', async () => {
  for (const p of ['/matchday-kitchen/', '/matchday-kitchen/login/', '/matchday-kitchen/kitchen/', '/matchday-kitchen/orders/FD-1/']) {
    const r = await fetch(`${BASE}${p}`);
    assert.equal(r.status, 200, p);
    assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'self'/);
    const html = await r.text();
    assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
    assert.match(html, /MatchDay Kitchen \| Lobi Stars FC/);
  }
  assert.equal((await fetch(`${BASE}/matchday-kitchen/nope/`)).status, 404);
  assert.equal((await fetch(`${BASE}/api/matchday-kitchen/kitchen`)).status, 401, 'no session, no data');
});

test('website admins see kitchen staff, shifts, notes and the activity log read-only', async () => {
  const H = { 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
  const get = v => fetch(`${BASE}/api/admin/matchday-kitchen?view=${v}`, { headers: H }).then(r => r.json());
  assert.ok((await get('staff')).staff.some(s => s.staffId === SUP.staffId));
  assert.ok((await get('shifts')).shifts.some(s => s.code === COOK.staffId));
  assert.ok((await get('notes')).notes.some(n => n.text.includes(T)));
  assert.ok((await get('activity')).rows.some(a => a.code === COOK.staffId));
  assert.equal((await fetch(`${BASE}/api/admin/matchday-kitchen`, { method: 'POST', headers: H, body: '{}' })).status, 405, 'nothing can be changed');
  assert.throws(() => sql(`DELETE FROM mk_activity WHERE actor_code = '${COOK.staffId}';`), /cannot be deleted|SQLITE|Error/, 'the activity log cannot be deleted');
});
