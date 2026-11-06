// MatchDay Kitchen staff area (/matchday-kitchen): its own staff and sign-in,
// never the admin back end; the kitchen screen changes the website's real
// orders, the menu page the real menu; roles; everything in the activity log;
// switching someone off signs them out; lockout; private pages.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './media-helpers.mjs';
import { officialCookie } from './wa-device-helper.mjs';
import { hashPassword } from '../functions/api/_lib/password.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const T = Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z]/g, 'Q');
const SA_EMAIL = `mk-sa-${T.toLowerCase()}@example.com`, SA_PW = 'Kitchen-Super-2026!';
const COOK = { staffId: `LSK-${T}1`, name: 'Ada Cook', role: 'cook' };
const SUP = { staffId: `LSK-${T}2`, name: 'Bola Super', role: 'supervisor' };
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const rows = q => JSON.parse(sql(q))[0].results;
let suya;

async function signIn(login, password, extra = {}) {
  const r = await fetch(`${BASE}/api/matchday-kitchen/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ login, password, ...extra }) });
  const cookie = (r.headers.get('set-cookie') || '').match(/ls_mdk=([^;]+)/)?.[1];
  return { status: r.status, data: await r.json().catch(() => ({})), cookie };
}
async function signCode(loginCode, fromIp = ip()) {
  const r = await fetch(`${BASE}/api/matchday-kitchen/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': fromIp }, body: JSON.stringify({ loginCode }) });
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

test('Super Admin signs in with the website email; kitchen staff with a login code only; neither opens /admin', async () => {
  sql(`INSERT INTO admin_users (id, name, email, password_hash, role, active, test_account) VALUES ('mkt_${T}', 'Kitchen Super Tester', '${SA_EMAIL}', '${await hashPassword(SA_PW)}', 'super_admin', 1, 1);`);
  const sa = await signIn(SA_EMAIL.toUpperCase(), SA_PW);
  assert.equal(sa.status, 200, JSON.stringify(sa.data)); assert.ok(sa.cookie);
  const A = await as(sa.cookie);
  assert.equal(A.s.user.kind, 'admin'); assert.equal(A.s.perms.staff, true);
  // The kitchen cookie never opens the admin back end.
  assert.equal((await fetch(`${BASE}/api/admin/me`, { headers: { Cookie: `ls_mdk=${sa.cookie}` } })).status, 401);
  for (const p of [COOK, SUP]) {
    const r = await A.call('staff', { action: 'add', ...p, staffId: p.staffId.toLowerCase() });
    assert.equal(r.status, 200, `adds ${p.name} (ID saved in capitals)`);
    assert.match(r.data.loginCode, /^\d{4}-\d{4}$/, 'an 8-number login code, shown once');
    assert.equal(r.data.staffId, p.staffId);
    p.code = r.data.loginCode; p.id = r.data.id;
  }
  // No Staff ID given: the website makes one.
  const auto = await A.call('staff', { action: 'add', name: 'Auto Number', role: 'pass' });
  assert.match(auto.data.staffId, /^LSK-\d{3,}$/);
  sql(`DELETE FROM mk_staff WHERE id = '${auto.data.id}';`);
  assert.equal((await A.call('staff', { action: 'add', ...COOK, name: 'Someone Else' })).status, 400, 'Staff IDs are unique');
  const list = (await A.call('staff')).data.staff;
  assert.ok(list.some(s => s.staffId === COOK.staffId && s.role === 'cook'));

  // The code is stored only as a hash.
  const stored = rows(`SELECT login_code_hash, password_hash FROM mk_staff WHERE id = '${COOK.id}'`)[0];
  assert.ok(stored.login_code_hash && !stored.login_code_hash.includes(COOK.code.replace('-', '')));
  // Staff ID and password no longer sign anyone in.
  assert.equal((await signIn(COOK.staffId, 'Grill-Fire-77')).status, 400);
  const cook = await signCode(COOK.code);
  assert.equal(cook.status, 200, JSON.stringify(cook.data));
  assert.equal((await fetch(`${BASE}/api/admin/me`, { headers: { Cookie: `ls_mdk=${cook.cookie}` } })).status, 401, 'kitchen staff cannot open /admin');
  const C = await as(cook.cookie);
  assert.equal(C.s.user.code, COOK.staffId); assert.equal(C.s.perms.price, false); assert.equal(C.s.perms.cancel, false);
  assert.equal((await C.call('staff')).status, 403, 'cooks do not manage staff');
  // A non-Super-Admin website account cannot sign in with an email.
  assert.equal((await signIn('nobody-here@example.com', 'whatever-123')).status, 401);
});

test('the kitchen screen moves the real order; the menu page changes the real menu; roles are enforced; all recorded', async () => {
  const sa = await signIn(SA_EMAIL, SA_PW), A = await as(sa.cookie);
  const cook = await signCode(COOK.code), C = await as(cook.cookie);
  const sup = await signCode(SUP.code), S = await as(sup.cookie);
  const W = await as(`${sup.cookie}; ${officialCookie()}`);
  // A WhatsApp order, confirmed as paid: it is now New on the kitchen screen.
  const o = await fetch(`${BASE}/api/food/whatsapp-order`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ name: 'Kitchen Fan', phone: `0803${String(Math.random()).slice(2, 9)}`, fulfilment: 'seat', seat: 'K12', notes: 'No pepper', items: [{ id: 'suya', qty: 2 }] }) }).then(r => r.json());
  assert.ok(o.ref, JSON.stringify(o));
  const id = rows(`SELECT id FROM food_orders WHERE ref = '${o.ref}';`)[0].id;
  assert.equal((await C.call('order', { id, to: 'CANCELLED' })).status, 403, 'a cook cannot cancel');
  // Not paid yet: in the board's "Awaiting payment" box (with a WhatsApp chat link), not in the kitchen columns.
  let bd = (await S.call('board')).data;
  const un = bd.unpaid.find(u => u.ref === o.ref);
  assert.ok(un, 'in Awaiting payment'); assert.equal(un.failed, false); assert.equal(un.chatUrl, null, 'no reply link away from the official device');
  assert.match((await W.call('board')).data.unpaid.find(u => u.ref === o.ref).chatUrl, /^https:\/\/wa\.me\/234/);
  // Paid (as a Paystack payment does): it now waits for a supervisor to confirm it.
  rows(`UPDATE food_orders SET payment_status = 'paid', order_status = 'PAID', paid_iso = '${new Date().toISOString()}' WHERE id = '${id}';`);
  bd = (await S.call('board')).data;
  assert.ok(!bd.unpaid.some(u => u.ref === o.ref), 'paid: leaves Awaiting payment');
  let k = (await S.call('kitchen')).data.tickets.find(t => t.ref === o.ref);
  assert.ok(k, 'on the kitchen screen'); assert.equal(k.next.label, 'Confirm order'); assert.equal(k.note, 'No pepper'); assert.equal(k.items[0].qty, 2);
  // The alarm: a new (paid, not confirmed) order beeps until a supervisor or Super Admin confirms or rejects it.
  assert.ok((await S.call('pulse')).data.newOrders.some(p => p.ref === o.ref), 'new order alarm');
  assert.equal((await C.call('order', { id, to: k.next.to })).status, 403, 'a cook sees it but cannot confirm it');
  assert.equal((await C.call('order', { id, to: 'PREPARING' })).status, 403, 'nor skip past it');
  assert.equal((await C.call('order', { id, to: 'CANCELLED' })).status, 403, 'nor reject it');
  assert.equal((await C.call(`order?id=${id}`)).data.needsSupervisor, true); assert.equal((await C.call(`order?id=${id}`)).data.moves.length, 0);
  assert.ok((await S.call(`order?id=${id}`)).data.moves.some(m => m.to === 'CANCELLED'), 'a supervisor can reject it');
  assert.equal((await S.call('order', { id, to: k.next.to })).status, 200);
  const cooking = (await C.call('pulse')).data;
  assert.ok(!(await S.call('pulse')).data.newOrders.some(p => p.ref === o.ref), 'confirming stops that alarm');
  assert.ok(cooking.cook.some(p => p.ref === o.ref), 'and starts the cooking alarm');
  let told = false; for (let i = 0; i < 10 && !told; i++) { told = rows(`SELECT attempt FROM food_notification_log WHERE order_id = '${id}'`).some(l => l.attempt === 'cook'); if (!told) await new Promise(r => setTimeout(r, 1500)); }
  assert.ok(told, 'devices are told too (sent in the background)');
  k = (await C.call('kitchen')).data.tickets.find(t => t.ref === o.ref);
  assert.equal(k.statusLabel, 'Received'); assert.equal(k.next.label, 'Start cooking');
  // An order for half-time rings 30 minutes before it is due, not straight away.
  rows(`UPDATE food_orders SET deliver_at = '${new Date(Date.now() + 2 * 3600e3).toISOString()}', deliver_when = 'half-time' WHERE id = '${id}';`);
  assert.ok(!(await C.call('pulse')).data.cook.some(p => p.ref === o.ref), 'not due yet: quiet');
  rows(`UPDATE food_orders SET deliver_at = NULL, deliver_when = 'now' WHERE id = '${id}';`);
  assert.equal((await C.call('order', { id, to: k.next.to })).status, 200, 'anyone can start cooking');
  assert.ok(!(await C.call('pulse')).data.cook.some(p => p.ref === o.ref), 'cooking started: quiet');
  k = (await C.call('kitchen')).data.tickets.find(t => t.ref === o.ref);
  assert.equal(k.statusLabel, 'Preparing'); assert.equal(k.next.label, 'Food ready');
  assert.equal((await C.call('order', { id, to: k.next.to })).status, 200);
  assert.equal(rows(`SELECT order_status FROM food_orders WHERE id = '${id}';`)[0].order_status, 'READY', "the website's real order is Ready");
  assert.ok((await S.call('board')).data.columns.ready.orders.some(t => t.ref === o.ref), 'in the Ready column');
  assert.equal((await C.call('order', { id, to: 'OUT_FOR_DELIVERY' })).status, 403, 'a cook does not take it out');
  assert.equal((await S.call('order', { id, to: 'OUT_FOR_DELIVERY' })).status, 200);
  const board = (await S.call('board')).data.columns;
  assert.ok(board.out.orders.some(t => t.ref === o.ref), 'in the On the way column');
  // Late: not delivered within 5 minutes of payment.
  rows(`UPDATE food_orders SET paid_iso = '${new Date(Date.now() - 10 * 60e3).toISOString()}' WHERE id = '${id}';`);
  const pl = (await S.call('pulse')).data;
  assert.equal(pl.lateMinutes, 5); assert.ok(pl.late.some(p => p.ref === o.ref), 'late order alarm');
  // Delivered: the receipt (no email on this order, so WhatsApp, one tap).
  k = (await S.call('kitchen')).data.tickets.find(t => t.ref === o.ref);
  assert.equal(k.next.label, 'Mark delivered');
  const dl = await W.call('order', { id, to: k.next.to });
  assert.equal(dl.status, 200); assert.match(dl.data.receipt.whatsappUrl, /^https:\/\/wa\.me\/234\d+\?text=/);
  assert.ok(!(await S.call('pulse')).data.late.some(p => p.ref === o.ref), 'delivered: no longer late');
  assert.equal((await C.call('receipt', { id, via: 'whatsapp' })).status, 403, 'not from another device');
  assert.equal((await C.call(`receipt-data?id=${id}`)).status, 403);
  assert.equal((await W.call('receipt', { id, via: 'whatsapp' })).status, 200);
  // The receipt picture's details (items with prices, total, the fan's chat link, the PDF link).
  const rd = (await W.call(`receipt-data?id=${id}`)).data;
  assert.equal(rd.ref, o.ref); assert.equal(rd.items[0].qty, 2); assert.ok(rd.items[0].priceKobo > 0); assert.ok(rd.totalKobo > 0);
  assert.match(rd.chatUrl, /^https:\/\/wa\.me\/234\d+\?text=/); assert.match(rd.pdfUrl, /\/api\/food\/receipt\?ref=/);
  assert.ok(rows(`SELECT receipt_wa_at FROM food_orders WHERE id = '${id}';`)[0].receipt_wa_at, 'WhatsApp receipt recorded');

  // Menu: anyone can turn a dish on or off; fans see Not ready; only supervisors (and Super Admins) change prices or turn all.
  suya = rows(`SELECT price_kobo, sold_out FROM food_items WHERE id = 'suya';`)[0];
  assert.equal((await C.call('menu', { id: 'suya', action: 'soldout' })).status, 200);
  assert.equal(rows(`SELECT sold_out FROM food_items WHERE id = 'suya';`)[0].sold_out, 1, 'off on the website menu');
  const fanItem = async () => (await fetch(`${BASE}/api/food/menu`, { cache: 'no-store' }).then(r => r.json())).categories.flatMap(c => c.items).find(i => i.id === 'suya');
  let fi = await fanItem();
  if (fi) { assert.equal(fi.soldOut, true); assert.equal(fi.notReady, true, 'fans see Not ready, not Sold out'); }
  assert.equal((await C.call('menu', { id: 'suya', action: 'back' })).status, 200);
  assert.equal(rows(`SELECT sold_out FROM food_items WHERE id = 'suya';`)[0].sold_out, 0);
  fi = await fanItem();
  if (fi) { assert.equal(fi.soldOut, false); assert.equal(fi.notReady, false); }
  assert.equal((await C.call('menu', { action: 'all_off' })).status, 403, 'a cook cannot turn everything off');
  assert.equal((await C.call('menu')).data.canAll, false);
  assert.equal((await C.call('menu', { id: 'suya', action: 'price', price: '2000' })).status, 403, 'a cook cannot change prices');
  assert.equal((await S.call('menu', { id: 'suya', action: 'price', price: 'abc' })).data.error, 'Enter the price as a number above 0, e.g. 2500.');
  assert.equal((await S.call('menu', { id: 'suya', action: 'price', price: '-5' })).status, 400);
  assert.equal((await S.call('menu', { id: 'suya', action: 'price', price: '1650' })).status, 200);
  assert.equal(rows(`SELECT price_kobo FROM food_items WHERE id = 'suya';`)[0].price_kobo, 165000);

  // Activity log: everyone's for the Super Admin (and CSV); only their own for staff.
  const all = (await A.call('activity')).data;
  assert.ok(all.rows.some(a => a.code === COOK.staffId && a.action === `Order ${o.ref}: Preparing to Ready`), 'status change under the cook');
  assert.ok(all.rows.some(a => a.code === COOK.staffId && /^Turned .*Suya off \(not ready\)$/.test(a.action)));
  assert.ok(all.rows.some(a => a.code === SUP.staffId && /^Changed the price of .+ to ₦1,650$/.test(a.action)));
  const mine = (await C.call('activity')).data;
  assert.ok(mine.rows.length && mine.rows.every(a => a.code === COOK.staffId), 'staff see only their own');
  const csv = await fetch(`${BASE}/api/matchday-kitchen/activity?format=csv`, { headers: { Cookie: `ls_mdk=${sa.cookie}` } });
  assert.equal(csv.status, 200); assert.match(await csv.text(), /What happened/);
  assert.equal((await fetch(`${BASE}/api/matchday-kitchen/activity?format=csv`, { headers: { Cookie: `ls_mdk=${cook.cookie}` } })).status, 403);
  // Changes need the session token.
  assert.equal((await fetch(`${BASE}/api/matchday-kitchen/menu`, { method: 'POST', headers: { Cookie: `ls_mdk=${cook.cookie}`, 'Content-Type': 'application/json' }, body: '{"id":"suya","action":"soldout"}' })).status, 403);
});

test('shifts, handover notes (pin: supervisors only), switching off signs out at once, wrong codes refused', async () => {
  const cook = await signCode(COOK.code), C = await as(cook.cookie);
  const sup = await signCode(SUP.code), S = await as(sup.cookie);
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
  assert.equal((await signCode(COOK.code)).status, 403, 'switched off');
  assert.equal((await A.call('staff', { action: 'edit', id: cookRow.id, active: true })).status, 200);
  // Wrong codes: refused, and 10 from one connection stop it for 15 minutes.
  const badIp = ip();
  for (let i = 0; i < 10; i++) assert.equal((await signCode('0000-0001', badIp)).status, 401);
  assert.equal((await signCode(SUP.code, badIp)).status, 429, 'stopped, even with a right code');
  assert.equal((await signCode(SUP.code)).status, 200, 'another connection is not affected');
  assert.equal((await signCode('123')).status, 400, 'too short');
});

test('a supervisor has the kitchen back end: all activity, cooks and pass staff, settings; only a Super Admin handles supervisors', async () => {
  const sup = await signCode(SUP.code), S = await as(sup.cookie);
  assert.equal(S.s.perms.staff, true); assert.equal(S.s.perms.activityAll, true); assert.equal(S.s.perms.superAdmin, false); assert.equal(S.s.perms.price, true); assert.equal(S.s.perms.cancel, true);
  const list = (await S.call('staff')).data;
  assert.ok(list.staff.some(x => x.staffId === COOK.staffId)); assert.equal(list.addRoles.supervisor, undefined); assert.ok(list.addRoles.cook);
  assert.ok((await S.call('activity')).data.rows.some(a => a.code !== SUP.staffId), "sees everyone's activity");
  assert.equal((await fetch(`${BASE}/api/admin/me`, { headers: { Cookie: `ls_mdk=${sup.cookie}` } })).status, 401, 'never the website admin');
  assert.equal((await S.call('check')).status, 403, 'the data check stays with Super Admins');
  // Adds a cook and gives a new code; the old code stops and the person is signed out.
  const added = await S.call('staff', { action: 'add', name: `Temp Cook ${T}`, role: 'cook' });
  assert.equal(added.status, 200); const old = added.data.loginCode;
  const tc = await signCode(old); assert.equal(tc.status, 200);
  const nc = await S.call('staff', { action: 'edit', id: added.data.id, newCode: true });
  assert.match(nc.data.loginCode, /^\d{4}-\d{4}$/); assert.notEqual(nc.data.loginCode, old);
  assert.equal((await fetch(`${BASE}/api/matchday-kitchen/session`, { headers: { Cookie: `ls_mdk=${tc.cookie}` } })).status, 401, 'signed out at once');
  assert.equal((await signCode(old)).status, 401, 'the old code stops');
  assert.equal((await signCode(nc.data.loginCode)).status, 200);
  // Supervisors: not for supervisors.
  assert.equal((await S.call('staff', { action: 'add', name: 'Another Boss', role: 'supervisor' })).status, 403);
  assert.equal((await S.call('staff', { action: 'edit', id: added.data.id, role: 'supervisor' })).status, 403, 'cannot promote');
  assert.equal((await S.call('staff', { action: 'edit', id: SUP.id, newCode: true })).status, 403, "cannot change a supervisor's code");
  assert.equal((await S.call('staff', { action: 'settings', telegramUrl: '', cancelRoles: ['pass', 'supervisor'], priceRoles: ['supervisor'], lateMinutes: 5 })).status, 200, 'changes the settings');
  sql(`DELETE FROM mk_staff WHERE id = '${added.data.id}';`);
});

test('every dish has a switch: a supervisor can turn all off and on; stock that ran out stays off and says Sold out', async () => {
  const S = await as((await signCode(SUP.code)).cookie);
  const keep = rows(`SELECT id, sold_out, stock FROM food_items WHERE archived = 0`);
  const id = keep.find(k => k.id !== 'suya').id;
  try {
    assert.equal((await S.call('menu')).data.canAll, true);
    sql(`UPDATE food_items SET stock = 0, sold_out = 1 WHERE id = '${id}';`);
    assert.ok((await S.call('menu', { action: 'all_off' })).data.changed >= 1);
    assert.equal(rows(`SELECT COUNT(*) AS n FROM food_items WHERE archived = 0 AND sold_out = 0`)[0].n, 0, 'all off');
    assert.ok((await S.call('menu', { action: 'all_on' })).data.changed >= 1);
    assert.equal(rows(`SELECT sold_out FROM food_items WHERE id = '${id}'`)[0].sold_out, 1, 'no stock left: stays off');
    const item = (await fetch(`${BASE}/api/food/menu`, { cache: 'no-store' }).then(r => r.json())).categories.flatMap(c => c.items).find(i => i.id === id);
    if (item) { assert.equal(item.soldOut, true); assert.equal(item.notReady, false, 'really sold out'); }
    assert.ok((await S.call('activity')).data.rows.some(a => /^Turned \d+ dish(es)? on \(ready\)$/.test(a.action)));
  } finally {
    sql(keep.map(k => `UPDATE food_items SET sold_out = ${k.sold_out}, stock = ${k.stock === null ? 'NULL' : k.stock} WHERE id = '${k.id}';`).join(' '));
  }
});

test('only supervisors and Super Admins add dishes, delete dishes and change prices; fans get the new menu at once', async () => {
  const S = await as((await signCode(SUP.code)).cookie), A = await as((await signIn(SA_EMAIL, SA_PW)).cookie);
  const added = await S.call('staff', { action: 'add', name: `Menu Cook ${T}`, role: 'pass' });
  const P = await as((await signCode(added.data.loginCode)).cookie);
  const fan = async () => (await fetch(`${BASE}/api/food/menu`, { cache: 'no-store' }).then(r => r.json())).categories.flatMap(c => c.items);
  const cat = (await S.call('menu')).data.categories[0].id;
  const name = `Test Pie ${T}`;
  try {
    assert.equal(P.s.perms.menu, false); assert.equal(P.s.perms.price, false); assert.equal(S.s.perms.menu, true); assert.equal(A.s.perms.menu, true);
    assert.equal((await P.call('menu')).data.categories.length, 0);
    assert.equal((await P.call('menu', { action: 'add', item: { name, category: cat, price: 500 } })).status, 403);
    assert.equal((await S.call('menu', { action: 'add', item: { name: '', category: cat, price: 500 } })).status, 400);
    assert.equal((await S.call('menu', { action: 'add', item: { name, category: cat, price: 0 } })).status, 400);
    const r = await S.call('menu', { action: 'add', item: { name, category: cat, price: '1,500', description: 'Hot and fresh' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await S.call('menu', { action: 'add', item: { name: name.toUpperCase(), category: cat, price: 500 } })).status, 400, 'no two dishes with one name');
    let it = (await fan()).find(i => i.id === r.data.id);
    assert.equal(it.priceKobo, 150000); assert.equal(it.soldOut, false);
    // Rename: supervisors and Super Admins; fans see it; no blanks or duplicates; orders keep their name.
    assert.equal((await P.call('menu', { action: 'rename', id: r.data.id, name: 'Nope' })).status, 403);
    assert.equal((await S.call('menu', { action: 'rename', id: r.data.id, name: ' ' })).status, 400);
    const other = (await fan()).find(i => i.id !== r.data.id);
    assert.equal((await S.call('menu', { action: 'rename', id: r.data.id, name: other.name.toUpperCase() })).status, 400, 'no two dishes with one name');
    assert.equal((await S.call('menu', { action: 'rename', id: 'no-such-dish', name: 'Ghost Dish' })).status, 404);
    const rn = await A.call('menu', { action: 'rename', id: r.data.id, name: `${name}   Skidd` });
    assert.equal(rn.status, 200); assert.equal(rn.data.name, `${name} Skidd`);
    assert.equal((await fan()).find(i => i.id === r.data.id).name, `${name} Skidd`);
    assert.ok((await A.call('activity')).data.rows.some(a => a.action === `Renamed ${name} to ${name} Skidd`), 'recorded');
    assert.equal((await S.call('menu', { action: 'rename', id: r.data.id, name })).status, 200);
    // Prices: the settings can no longer give this to anyone else.
    assert.equal((await S.call('staff', { action: 'settings', telegramUrl: '', cancelRoles: ['pass', 'supervisor'], priceRoles: ['pass', 'cook'], lateMinutes: 5 })).status, 200);
    const P2 = await as((await signCode(added.data.loginCode)).cookie);
    assert.equal(P2.s.perms.price, false);
    assert.equal((await P.call('menu', { action: 'price', id: r.data.id, price: 900 })).status, 403);
    assert.equal((await A.call('menu', { action: 'price', id: r.data.id, price: 0 })).status, 400, 'never free by mistake');
    assert.equal((await A.call('menu', { action: 'price', id: r.data.id, price: 900 })).status, 200);
    it = (await fan()).find(i => i.id === r.data.id);
    assert.equal(it.priceKobo, 90000);
    // Delete: refused for others; gone for fans; a dish with past orders is kept for reports.
    assert.equal((await P.call('menu', { action: 'delete', id: r.data.id })).status, 403);
    const del = await S.call('menu', { action: 'delete', id: r.data.id });
    assert.equal(del.status, 200); assert.ok(!del.data.archived, 'never ordered: removed');
    assert.ok(!(await fan()).some(i => i.id === r.data.id));
    assert.equal(rows(`SELECT COUNT(*) AS n FROM food_items WHERE id = '${r.data.id}'`)[0].n, 0);
    assert.equal((await S.call('menu', { action: 'delete', id: r.data.id })).status, 404);
    const r2 = await S.call('menu', { action: 'add', item: { name: `${name} 2`, category: cat, price: 700 } });
    sql(`INSERT INTO food_orders (id, seat, stand, phone, email, items_json, total_kobo, paystack_reference, payment_status) VALUES ('fo_${T}', 'A1', 'Popular Stand', '08030000000', 'fan@example.com', '[{"id":"${r2.data.id}","qty":1}]', 70000, 'ref_${T}', 'paid');`);
    const del2 = await A.call('menu', { action: 'delete', id: r2.data.id });
    assert.equal(del2.data.archived, true, 'past orders: kept for reports');
    assert.ok(!(await fan()).some(i => i.id === r2.data.id));
    assert.ok((await A.call('activity')).data.rows.some(a => a.action === `Deleted ${name} from the menu` && a.code === SUP.staffId), 'recorded');
    sql(`DELETE FROM food_orders WHERE id = 'fo_${T}'; DELETE FROM food_items WHERE id = '${r2.data.id}';`);
  } finally {
    sql(`DELETE FROM mk_staff WHERE id = '${added.data.id}';`);
  }
});

test('delivery by stand: ready orders grouped, in seat order, still-cooking counted; marking delivered; the food report', async () => {
  const S = await as((await signCode(SUP.code)).cookie), A = await as((await signIn(SA_EMAIL, SA_PW)).cookie);
  const added = await S.call('staff', { action: 'add', name: `Runner ${T}`, role: 'delivery' });
  const R = await as((await signCode(added.data.loginCode)).cookie);
  const iso = new Date().toISOString();
  const stand = `Stand ${T}`;
  const put = (id, seat, status, extra = '') => `INSERT INTO food_orders (id, ref, seat, stand, phone, email, items_json, total_kobo, paystack_reference, payment_status, order_status, paid_iso, created_iso, channel, customer_name) VALUES ('${id}', '${id}', '${seat}', '${stand}', '0803000000${seat.length}', '', '[{"id":"suya","name":"Report Suya ${T}","qty":2,"priceKobo":50000}]', 100000, 'r-${id}', 'paid', '${status}', '${iso}', '${iso}', 'paystack', 'Fan ${seat}');${extra}`;
  const ids = [`d1${T}`, `d2${T}`, `d3${T}`];
  sql(put(ids[0], 'B-10', 'OUT_FOR_DELIVERY') + put(ids[1], 'B-2', 'OUT_FOR_DELIVERY') + put(ids[2], 'C-1', 'PREPARING'));
  try {
    const d = (await R.call('delivery')).data;
    const g = d.groups.find(x => x.name === stand);
    assert.ok(g, 'the stand is there');
    assert.deepEqual(g.ready.map(o => o.seat), ['B-2', 'B-10'], 'seat order, 2 before 10');
    assert.equal(g.cooking, 1, 'still cooking is only counted');
    assert.ok(!JSON.stringify(g.ready).includes('08030000003'), 'phone numbers stay masked');
    assert.equal((await R.call('order', { id: ids[1], to: 'DELIVERED' })).status, 200, 'a runner can mark delivered');
    assert.deepEqual((await R.call('delivery')).data.groups.find(x => x.name === stand).ready.map(o => o.seat), ['B-10']);
    // The report: supervisors and Super Admins; totals, no customer details.
    assert.equal((await R.call('report-settings')).status, 403);
    assert.equal((await fetch(`${BASE}/api/matchday-kitchen/report`, { headers: { Cookie: `ls_mdk=${(await signCode(added.data.loginCode)).cookie}` } })).status, 403);
    assert.equal((await S.call('report-settings', { emails: 'not an email' })).status, 400);
    const saved = await S.call('report-settings', { emails: 'chef@example.com\nboss@example.com' });
    assert.deepEqual(saved.data.emails, ['chef@example.com', 'boss@example.com']);
    assert.deepEqual((await A.call('report-settings')).data.emails, ['chef@example.com', 'boss@example.com']);
    const sup = await signCode(SUP.code);
    const html = await fetch(`${BASE}/api/matchday-kitchen/report`, { headers: { Cookie: `ls_mdk=${sup.cookie}` } }).then(r => r.text());
    assert.match(html, /Match-day food report/); assert.match(html, /Top dishes/); assert.ok(html.includes(`Report Suya ${T}`)); assert.ok(html.includes(stand)); assert.match(html, /Hour by hour/);
    assert.ok(!html.includes(`Fan B-2`), 'no customer names'); assert.ok(!html.includes('fan@example.com'));
  } finally {
    sql(`DELETE FROM food_orders WHERE id IN (${ids.map(i => `'${i}'`).join(',')}); DELETE FROM mk_staff WHERE id = '${added.data.id}'; DELETE FROM mk_settings WHERE key = 'report_emails';`);
  }
});

test('a new WhatsApp order alerts the kitchen: the alarm rings until it is confirmed or paid, and devices get an alert', async () => {
  const S = await as((await signCode(SUP.code)).cookie);
  const a = await S.call('staff', { action: 'add', name: `Alert Cook ${T}`, role: 'cook' });
  const cookie = (await signCode(a.data.loginCode)).cookie, C = await as(cookie);
  const place = async seat => { const r = await fetch(`${BASE}/api/food/whatsapp-order`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ name: 'Alert Fan', phone: `0803${String(Math.random()).slice(2, 9)}`, fulfilment: 'seat', seat, items: [{ id: 'suya', qty: 1 }] }) }).then(x => x.json()); assert.ok(r.ref, JSON.stringify(r)); return { ref: r.ref, id: rows(`SELECT id FROM food_orders WHERE ref = '${r.ref}'`)[0].id }; };
  const endpoint = `https://127.0.0.1:1/push-${T}`, sub = { endpoint, keys: { p256dh: 'p', auth: 'a' } };
  const device = () => rows(`SELECT is_active, kitchen, mk_app, staff_id, want_paid FROM push_subs WHERE endpoint = '${endpoint}'`)[0];
  const made = [];
  try {
    // The session gives the app what it needs to register a device; bad devices are refused.
    assert.ok(C.s.pushKey, 'the app gets the push key');
    assert.equal((await C.call('push', { action: 'on', subscription: { endpoint: 'http://not-secure/' } })).status, 400);
    assert.equal((await C.call('push', { action: 'nonsense' })).status, 400);
    assert.equal((await fetch(`${BASE}/api/matchday-kitchen/push`, { method: 'POST', body: '{}' })).status, 401, 'signed-in staff only');
    assert.equal((await C.call('push', { action: 'on', subscription: sub, deviceName: 'Test phone' })).status, 200);
    let d = device();
    assert.equal(d.is_active, 1); assert.equal(d.kitchen, 1); assert.equal(d.mk_app, 1); assert.equal(d.want_paid, 0); assert.equal(d.staff_id, a.data.id);
    assert.equal((await C.call('push', { action: 'test', endpoint })).data.ok, false, 'an unreachable device reports failure');

    // A new order rings every role's app, and is sent to devices and Telegram.
    const o = await place('W1'); made.push(o.id);
    const ring = async who => (await who.call('pulse')).data.whatsapp.find(p => p.ref === o.ref);
    assert.ok(!(await ring(C)), 'not for cooks: they get the cooking alarm'); assert.ok(await ring(S), 'a supervisor hears it');
    assert.ok(!(await S.call('pulse')).data.newOrders.some(p => p.ref === o.ref), 'it is not on the paid alarm');
    assert.ok(!(await S.call('pulse')).data.late.some(p => p.ref === o.ref), 'nor counted as late');
    const log = rows(`SELECT channel, attempt FROM food_notification_log WHERE order_id = '${o.id}'`);
    assert.ok(log.some(l => l.channel === 'push' && l.attempt === 'whatsapp'), JSON.stringify(log));
    assert.equal(rows(`SELECT kitchen_alerted_at FROM food_orders WHERE id = '${o.id}'`)[0].kitchen_alerted_at, null, 'the paid alert is still to come');

    // A cook can't confirm or reject it. A supervisor confirming stops the ring, for everyone.
    assert.equal((await C.call('order', { id: o.id, to: 'CONFIRMED' })).status, 403);
    assert.equal((await C.call('order', { id: o.id, to: 'CANCELLED' })).status, 403);
    assert.ok(await ring(S), 'still ringing');
    assert.equal((await S.call('order', { id: o.id, to: 'CONFIRMED' })).status, 200);
    assert.ok(!(await ring(S)), 'confirmed: quiet');
    assert.ok(!(await C.call('pulse')).data.cook.some(x => x.ref === o.ref), 'confirmed but not paid: no cooking alarm yet');
    // Rejecting stops it too.
    const rj = await place('W3'); made.push(rj.id);
    assert.equal((await S.call('order', { id: rj.id, to: 'REJECTED', reason: 'sold_out' })).status, 200);
    assert.ok(!(await S.call('pulse')).data.whatsapp.some(x => x.ref === rj.ref), 'rejected: quiet');
    // Recording the payment straight away stops it too, and cooking is then pending.
    const p = await place('W2'); made.push(p.id);
    assert.ok((await S.call('pulse')).data.whatsapp.some(x => x.ref === p.ref));
    assert.equal((await S.call('payment', { id: p.id, method: 'cash', amount: '99999', proof: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 9, 8, 7, ...T.split('').map(x => x.charCodeAt(0))]).toString('base64') })).status, 200);
    const after = (await S.call('pulse')).data;
    assert.ok(!after.whatsapp.some(x => x.ref === p.ref)); assert.ok((await C.call('pulse')).data.cook.some(x => x.ref === p.ref), 'now on the cooking alarm');
    assert.ok(!after.newOrders.some(x => x.ref === p.ref), 'no second confirmation needed');
    let told = false; for (let i = 0; i < 10 && !told; i++) { told = rows(`SELECT attempt FROM food_notification_log WHERE order_id = '${p.id}'`).some(l => l.attempt === 'cook'); if (!told) await new Promise(r => setTimeout(r, 1500)); }
    assert.ok(told, 'devices are told to start cooking (sent in the background)');

    // The idle sign-out keeps the alerts; the sign-out button and "turn off" stop them.
    assert.equal((await C.call('logout', { idle: true })).status, 200);
    assert.equal(device().is_active, 1, 'a resting tablet still rings');
    const C2 = await as((await signCode(a.data.loginCode)).cookie);
    assert.equal((await C2.call('push', { action: 'off', endpoint })).status, 200);
    assert.equal(device().is_active, 0);
    assert.equal((await C2.call('push', { action: 'on', subscription: sub })).status, 200);
    assert.equal((await C2.call('logout', {})).status, 200);
    assert.equal(device().is_active, 0, 'signed out with the button: no more orders on this device');
    // Switched off: the same.
    const C3 = await as((await signCode(a.data.loginCode)).cookie);
    await C3.call('push', { action: 'on', subscription: sub });
    assert.equal(device().is_active, 1);
    assert.equal((await S.call('staff', { action: 'edit', id: a.data.id, active: false })).status, 200);
    assert.equal(device().is_active, 0, 'switched off: no more orders on their devices');
  } finally {
    sql(`DELETE FROM push_subs WHERE endpoint = '${endpoint}'; DELETE FROM mk_staff WHERE id = '${a.data.id}';` + made.map(i => `DELETE FROM food_payment_proofs WHERE order_id = '${i}'; DELETE FROM food_orders WHERE id = '${i}';`).join(''));
  }
});

test('searching by order number finds an order from any day', async () => {
  const S = await as((await signCode(SUP.code)).cookie);
  const id = `FD-OLD${T}`, old = new Date(Date.now() - 20 * 86400e3).toISOString();
  sql(`INSERT INTO food_orders (id, ref, seat, phone, email, items_json, total_kobo, paystack_reference, payment_status, order_status, created_iso, channel, customer_name) VALUES ('${id}', '${id}', 'A1', '+2348031234567', '', '[]', 100, '${id}', 'pending', 'EXPIRED', '${old}', 'paystack', 'Old Fan');`);
  try {
    const found = (await S.call(`orders?q=${id}&day=2020-01-01`)).data;
    assert.equal(found.total, 1); assert.equal(found.everyDay, true); assert.equal(found.orders[0].ref, id);
    assert.ok(!(await S.call('orders')).data.orders.some(o => o.ref === id), 'no search: today only');
    assert.equal((await S.call(`orders?day=2020-01-01`)).data.everyDay, false);
    const t = (await S.call(`order?id=${id}`)).data.order;
    assert.equal(t.paid, false, 'the order page can tell it was never paid'); assert.equal(t.stage, null, 'and that it is not waiting');
  } finally { sql(`DELETE FROM food_orders WHERE id = '${id}';`); }
});

test('one WhatsApp number: orders go only to it, replies only from its approved device, and a rejection sends nothing', async () => {
  const sa = await signIn(SA_EMAIL, SA_PW), A = await as(sa.cookie);
  const sup = await signCode(SUP.code), S = await as(sup.cookie), C = await as((await signCode(COOK.code)).cookie);
  const place = async seat => { const r = await fetch(`${BASE}/api/food/whatsapp-order`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ name: 'Reply Fan', phone: `0803${String(Math.random()).slice(2, 9)}`, fulfilment: 'seat', seat, items: [{ id: 'suya', qty: 1 }] }) }).then(x => x.json()); assert.ok(r.ref, JSON.stringify(r)); return { ...r, id: rows(`SELECT id FROM food_orders WHERE ref = '${r.ref}'`)[0].id }; };
  const made = [];
  try {
    // Only a Super Admin approves a device.
    sql(`DELETE FROM mk_wa_devices WHERE added_by = 'tests' OR name = 'Kitchen phone';`); // the limit of 4 devices counts these
    assert.equal((await S.call('whatsapp-device', { action: 'this', name: 'Private phone' })).status, 403);
    assert.equal((await C.call('whatsapp-device', { action: 'this', name: 'Private phone' })).status, 403);
    assert.equal((await S.call('whatsapp-devices')).status, 403);
    const res = await fetch(`${BASE}/api/matchday-kitchen/whatsapp-device`, { method: 'POST', headers: { Cookie: `ls_mdk=${sa.cookie}`, 'Content-Type': 'application/json', 'X-CSRF-Token': A.s.csrf }, body: JSON.stringify({ action: 'this', name: 'Kitchen phone' }) });
    assert.equal(res.status, 200);
    const set = res.headers.get('set-cookie');
    assert.match(set, /^ls_mk_wa=[a-f0-9]{64}; HttpOnly; Secure; SameSite=Strict/);
    const device = set.split(';')[0];
    const W = await as(`${sup.cookie}; ${device}`);
    assert.equal(W.s.waDevice, true); assert.equal(S.s.waDevice, false, 'the same person on another device');
    assert.equal((await as(`${sup.cookie}; ls_mk_wa=${'a'.repeat(64)}`)).s.waDevice, false, 'a made-up device');
    const listed = (await A.call('whatsapp-devices')).data.devices.find(d => d.name === 'Kitchen phone');
    assert.ok(listed); assert.equal(JSON.stringify(listed).includes(device.split('=')[1]), false, 'the secret is never shown');

    // Orders go only to the official number.
    sql(`DELETE FROM food_settings WHERE key = 'bankDetails';`); // other tests may have blanked it: the real account is the default
    const o = await place('R1'); made.push(o.id);
    assert.match(o.whatsappUrl, /^https:\/\/wa\.me\/2347080094985\?/);
    assert.match(decodeURIComponent(o.whatsappUrl), /Fidelity Bank: 4011459917/);
    // Replies: only the approved device gets the fan's number.
    const seen = async who => JSON.stringify((await who.call('board')).data.unpaid.find(x => x.ref === o.ref));
    assert.match(await seen(W), /wa\.me\/2348/);
    for (const who of [S, C]) assert.doesNotMatch(await seen(who), /wa\.me/, 'others see the order, with nothing to reply with');
    assert.ok((await W.call(`order?id=${o.id}`)).data.chat.url.startsWith('https://wa.me/2348'));
    assert.equal((await S.call(`order?id=${o.id}`)).data.chat, null);
    assert.equal((await S.call(`order?id=${o.id}`)).data.order.phone.includes('•'), true, 'the number stays hidden');

    // Rejected: no message at all, even on the approved device.
    assert.equal((await W.call('order', { id: o.id, to: 'REJECTED', reason: 'sold_out' })).status, 200);
    const after = (await W.call(`order?id=${o.id}`)).data;
    assert.equal(after.chat, null, 'nothing to send'); assert.ok(!JSON.stringify(after).includes('wa.me'));
    const p = await place('R2'); made.push(p.id);
    assert.ok(!JSON.stringify((await W.call('board')).data).includes('rejectUrl'));
    // Recording a payment: the reply button only on the approved device.
    const jpg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 3, 1, 4, ...T.split('').map(x => x.charCodeAt(0))]).toString('base64');
    assert.match((await W.call('payment', { id: p.id, method: 'cash', amount: '99999', proof: jpg })).data.chatUrl, /^https:\/\/wa\.me\/2348/);

    // Removed: back to seeing orders only.
    assert.equal((await A.call('whatsapp-device', { action: 'remove', id: listed.id })).status, 200);
    assert.equal((await as(`${sup.cookie}; ${device}`)).s.waDevice, false);
    const q = await place('R3'); made.push(q.id);
    assert.doesNotMatch(JSON.stringify((await W.call('board')).data.unpaid.find(x => x.ref === q.ref)), /wa\.me/);
  } finally {
    sql(`DELETE FROM mk_wa_devices WHERE name = 'Kitchen phone';` + made.map(i => `DELETE FROM food_payment_proofs WHERE order_id = '${i}'; DELETE FROM food_orders WHERE id = '${i}';`).join(''));
  }
});

test('WhatsApp payments: evidence required, then the order goes on as if paid online; cooks cannot; a receipt cannot be reused', async () => {
  const supCookie = (await signCode(SUP.code)).cookie, S = await as(supCookie);
  const staff = async (name, role) => { const a = await S.call('staff', { action: 'add', name: `${name} ${T}`, role }); return { id: a.data.id, u: await as((await signCode(a.data.loginCode)).cookie) }; };
  const pass = await staff('Pay Pass', 'pass'), cook = await staff('Pay Cook', 'cook');
  const iso = new Date().toISOString();
  const put = (id, status, channel = 'whatsapp', pay = 'pending') => `INSERT INTO food_orders (id, ref, seat, stand, phone, email, items_json, total_kobo, paystack_reference, payment_status, order_status, created_iso, channel, customer_name) VALUES ('${id}', '${id}', 'A1', 'Popular Stand', '+2348031234567', '', '[{"id":"suya","name":"Suya","qty":1,"priceKobo":150000}]', 150000, 'r-${id}', '${pay}', '${status}', '${iso}', '${channel}', 'Abigail Fan');`;
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'].map(x => `WA${x}${T}`), [a, b, c, d, e, f] = ids;
  sql(put(a, 'AWAITING_WHATSAPP') + put(b, 'CONFIRMED') + put(c, 'EXPIRED') + put(d, 'AWAITING_WHATSAPP', 'paystack') + put(e, 'AWAITING_WHATSAPP') + put(f, 'AWAITING_WHATSAPP'));
  const jpg = (n = 1) => Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, ...Array(40).fill(n), 0xFF, 0xD9]).toString('base64');
  const pdf = Buffer.from('%PDF-1.4 receipt').toString('base64');
  const body = (id, over = {}) => ({ id, method: 'transfer', amount: '1500', proof: jpg(), ...over });
  const order = id => rows(`SELECT order_status, payment_status, paid_reference, paid_late, paid_iso FROM food_orders WHERE id = '${id}'`)[0];
  try {
    const up = (await pass.u.call('board')).data.unpaid.find(o => o.id === a);
    assert.equal(up.canPay, true); assert.equal(up.totalNaira, 1500);
    // Only supervisors and Super Admins.
    assert.equal(cook.u.s.perms.payment, false); assert.equal(pass.u.s.perms.payment, false); assert.equal(S.s.perms.payment, true);
    assert.equal((await pass.u.call('payment', body(a))).status, 403, 'an order handler cannot either');
    assert.equal((await cook.u.call('payment', body(a))).status, 403, 'a cook cannot record a payment');
    assert.equal((await cook.u.call('order', { id: a, to: 'PAID' })).status, 403, 'nor mark it paid another way');
    assert.equal((await S.call('order', { id: a, to: 'PAID' })).data.recordPayment, true, 'the plain status button is closed');
    assert.ok(!(await S.call(`order?id=${a}`)).data.moves.some(m => m.to === 'PAID'));
    assert.equal((await S.call(`order?id=${a}`)).data.canRecordPayment, true);
    assert.equal((await cook.u.call(`order?id=${a}`)).data.canRecordPayment, false);
    // The checks.
    assert.match((await S.call('payment', body(a, { proof: '' }))).data.error, /evidence/);
    assert.match((await S.call('payment', body(a, { proof: Buffer.from('<script>alert(1)</script>').toString('base64') }))).data.error, /not a picture/, 'a file is checked by what it really is');
    assert.match((await S.call('payment', body(a, { amount: '1000' }))).data.error, /less than the order total/);
    assert.equal((await S.call('payment', body(a, { method: 'gold' }))).status, 400);
    assert.equal((await S.call('payment', body(d))).status, 400, 'online orders are confirmed by Paystack');
    assert.equal(order(a).payment_status, 'pending', 'nothing changed yet');
    // Recorded: paid, in the kitchen, recorded and traceable.
    const r = await S.call('payment', body(a, { note: 'GTB ref 123' }));
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.chatUrl, null, 'no reply link away from the official device');
    const o = order(a);
    assert.equal(o.order_status, 'ACCEPTED', 'recording it also confirms it'); assert.equal(o.payment_status, 'paid'); assert.ok(o.paid_iso); assert.match(o.paid_reference, /^WhatsApp: Bank transfer, recorded by Bola Super/);
    assert.ok((await cook.u.call('kitchen')).data.tickets.some(t => t.id === a), 'on the kitchen screen like any paid order');
    assert.ok(!(await S.call('board')).data.unpaid.some(x => x.id === a), 'off the awaiting payment list');
    assert.equal((await cook.u.call('order', { id: a, to: 'PREPARING' })).status, 200, 'and it carries on as normal');
    // Twice: refused.
    assert.equal((await S.call('payment', body(a, { proof: jpg(9) }))).status, 409);
    // The evidence: same roles only; shown, never run.
    const info = (await S.call(`order?id=${a}`)).data.payment;
    assert.equal(info.method, 'Bank transfer'); assert.equal(info.note, 'GTB ref 123'); assert.match(info.by, /Bola Super/);
    assert.equal((await cook.u.call(`order?id=${a}`)).data.payment, null);
    assert.equal((await cook.u.call(`payment-proof?id=${a}`)).status, 403);
    assert.equal((await fetch(`${BASE}/api/matchday-kitchen/payment-proof?id=${a}`)).status, 401, 'never the public');
    const passCookie = (await signCode((await S.call('staff', { action: 'edit', id: pass.id, newCode: true })).data.loginCode)).cookie;
    pass.u = await as(passCookie);
    assert.equal((await pass.u.call(`payment-proof?id=${a}`)).status, 403);
    const pic = await fetch(`${BASE}/api/matchday-kitchen/payment-proof?id=${a}`, { headers: { Cookie: `ls_mdk=${supCookie}` } });
    assert.equal(pic.status, 200); assert.equal(pic.headers.get('content-type'), 'image/jpeg'); assert.equal(pic.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(Buffer.from(await pic.arrayBuffer()).toString('base64'), jpg());
    // The same receipt on another order: refused; a supervisor can allow it, and it stays flagged.
    const dup = await S.call('payment', body(b));
    assert.equal(dup.status, 409); assert.equal(dup.data.duplicate, a); assert.equal(dup.data.canOverride, true);
    const allowed = await S.call('payment', body(b, { allowDuplicate: true }));
    assert.equal(allowed.status, 200); assert.equal(allowed.data.duplicateOf, a);
    assert.equal((await S.call(`order?id=${b}`)).data.payment.duplicateOf, a);
    // A fan who paid after the order ran out of time; a PDF receipt; more than the total.
    const late = await S.call('payment', body(c, { proof: pdf, method: 'pos', amount: '2000' }));
    assert.equal(late.status, 200); assert.equal(order(c).paid_late, 1); assert.equal(order(c).order_status, 'ACCEPTED');
    assert.equal((await S.call(`order?id=${c}`)).data.payment.isPdf, true);
    const pdfFile = await fetch(`${BASE}/api/matchday-kitchen/payment-proof?id=${c}`, { headers: { Cookie: `ls_mdk=${supCookie}` } });
    assert.match(pdfFile.headers.get('content-disposition'), /^attachment/, 'a PDF is downloaded, not opened on our site');
    // The website admin can see it too.
    assert.equal((await fetch(`${BASE}/api/admin/food-orders/proof?id=${a}`)).status, 401);
    const adm = await fetch(`${BASE}/api/admin/food-orders/proof?id=${a}`, { headers: { 'x-admin-code': 'test-code-123' } });
    assert.equal(adm.status, 200); assert.equal(adm.headers.get('content-type'), 'image/jpeg');
    // An oversized upload is refused before it is read.
    assert.equal((await S.call('payment', body(f, { proof: 'x'.repeat(4000000) }))).status, 413);
    assert.equal((await S.call('payment', body(f, { proof: Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF]), Buffer.alloc(1600 * 1024, 1)]).toString('base64') }))).status, 400, 'over 1.5 MB');
    // A Super Admin too; and the log.
    const A = await as((await signIn(SA_EMAIL, SA_PW)).cookie);
    assert.equal((await A.call('payment', body(e, { proof: jpg(5) }))).status, 200);
    const log = (await A.call('activity')).data.rows;
    assert.ok(log.some(x => x.action.startsWith(`Order ${a}: recorded payment of ₦1,500 (Bank transfer), evidence saved`)), 'recorded in the log');
    assert.ok(log.some(x => x.action.includes(`the same receipt as order ${a} (allowed)`)));
    // Paid orders count in the report's WhatsApp line.
    const report = await fetch(`${BASE}/api/matchday-kitchen/report`, { headers: { Cookie: `ls_mdk=${passCookie}` } });
    assert.equal(report.status, 403, 'the report stays with supervisors');
  } finally {
    sql(`DELETE FROM food_payment_proofs WHERE order_id IN (${ids.map(i => `'${i}'`).join(',')}); DELETE FROM food_orders WHERE id IN (${ids.map(i => `'${i}'`).join(',')}); DELETE FROM mk_staff WHERE id IN ('${pass.id}', '${cook.id}');`);
  }
});

test('food ordering: supervisors and Super Admins open and close it, cooks only see it, fans are refused while closed', async () => {
  const before = rows(`SELECT value FROM food_settings WHERE key = 'orderingMode'`)[0]?.value || 'open';
  const sup = await signCode(SUP.code), S = await as(sup.cookie);
  const added = await S.call('staff', { action: 'add', name: `Order Cook ${T}`, role: 'cook' });
  const C = await as((await signCode(added.data.loginCode)).cookie);
  const sa = await signIn(SA_EMAIL, SA_PW), A = await as(sa.cookie);
  try {
    assert.equal(S.s.perms.ordering, true); assert.equal(A.s.perms.ordering, true); assert.equal(C.s.perms.ordering, false);
    assert.equal((await C.call('ordering')).data.canChange, false, 'a cook sees it, without the buttons');
    assert.equal((await C.call('ordering', { mode: 'closed' })).status, 403);
    assert.equal((await S.call('ordering', { mode: 'nonsense' })).status, 400);
    const closed = await S.call('ordering', { mode: 'closed' });
    assert.equal(closed.status, 200); assert.equal(closed.data.open, false); assert.equal(closed.data.mode, 'closed');
    assert.equal((await fetch(`${BASE}/api/food/menu`).then(r => r.json())).open, false, 'fans see it closed');
    const pay = await fetch(`${BASE}/api/food-checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ name: 'Closed Tester', items: [{ id: 'suya', qty: 1 }], seat: 'A1', stand: 'Popular Stand', phone: '08031234567' }) });
    assert.equal((await pay.json()).code, 'closed', 'and the server refuses the order');
    const wa = await fetch(`${BASE}/api/food/whatsapp-order`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ name: 'Closed Tester', items: [{ id: 'suya', qty: 1 }], seat: 'A1', stand: 'Popular Stand', phone: `0803${String(Date.now()).slice(-7)}` }) });
    assert.equal((await wa.json()).code, 'closed', 'WhatsApp orders too');
    assert.equal((await A.call('ordering', { mode: 'open' })).data.open, true, 'a Super Admin opens it');
    assert.equal((await fetch(`${BASE}/api/food/menu`).then(r => r.json())).open, true);
    assert.equal((await S.call('ordering', { mode: 'auto' })).data.mode, 'auto');
    const log = (await A.call('activity')).data.rows;
    assert.ok(log.some(a => a.code === SUP.staffId && a.action === 'Closed food ordering'), 'recorded under the name');
  } finally {
    sql(`UPDATE food_settings SET value = '${before}' WHERE key = 'orderingMode'; DELETE FROM mk_staff WHERE id = '${added.data.id}';`);
  }
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
  assert.ok((await get('activity')).rows.some(a => a.code === COOK.staffId || a.code === SUP.staffId));
  assert.equal((await fetch(`${BASE}/api/admin/matchday-kitchen`, { method: 'POST', headers: H, body: '{}' })).status, 405, 'nothing can be changed');
  assert.throws(() => sql(`DELETE FROM mk_activity WHERE actor_code = '${COOK.staffId}';`), /cannot be deleted|SQLITE|Error/, 'the activity log cannot be deleted');
});
