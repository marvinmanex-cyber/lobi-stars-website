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
  // A WhatsApp order, confirmed as paid: it is now New on the kitchen screen.
  const o = await fetch(`${BASE}/api/food/whatsapp-order`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ name: 'Kitchen Fan', phone: `0803${String(Math.random()).slice(2, 9)}`, fulfilment: 'seat', seat: 'K12', notes: 'No pepper', items: [{ id: 'suya', qty: 2 }] }) }).then(r => r.json());
  assert.ok(o.ref, JSON.stringify(o));
  const id = rows(`SELECT id FROM food_orders WHERE ref = '${o.ref}';`)[0].id;
  assert.equal((await C.call('order', { id, to: 'CANCELLED' })).status, 403, 'a cook cannot cancel');
  // Not paid yet: in the board's "Awaiting payment" box (with a WhatsApp chat link), not in the kitchen columns.
  let bd = (await C.call('board')).data;
  const un = bd.unpaid.find(u => u.ref === o.ref);
  assert.ok(un, 'in Awaiting payment'); assert.equal(un.failed, false); assert.match(un.chatUrl || '', /^https:\/\/wa\.me\/234/);
  assert.equal((await S.call('order', { id, to: 'PAID' })).status, 200);
  bd = (await C.call('board')).data;
  assert.ok(!bd.unpaid.some(u => u.ref === o.ref), 'paid: leaves Awaiting payment');
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
  // The receipt picture's details (items with prices, total, the fan's chat link, the PDF link).
  const rd = (await C.call(`receipt-data?id=${id}`)).data;
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
  assert.ok(all.rows.some(a => a.code === COOK.staffId && a.action === `Order ${o.ref}: Preparing to On the way`), 'status change under the cook');
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
  assert.ok((await get('activity')).rows.some(a => a.code === COOK.staffId));
  assert.equal((await fetch(`${BASE}/api/admin/matchday-kitchen`, { method: 'POST', headers: H, body: '{}' })).status, 405, 'nothing can be changed');
  assert.throws(() => sql(`DELETE FROM mk_activity WHERE actor_code = '${COOK.staffId}';`), /cannot be deleted|SQLITE|Error/, 'the activity log cannot be deleted');
});
