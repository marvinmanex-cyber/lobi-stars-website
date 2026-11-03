// Gate Control (/gate-control): the ticket stewards' own area. Its own staff and
// sign-in (never the admin back end); a gate must be chosen; scanning or typing
// a ticket shows who bought it, when, where and the price, and checks them in
// once only (also when five phones scan the same ticket at once); fake, used,
// wrong-match, cancelled and unpaid tickets are refused; supervisors re-admit;
// everything is recorded; the page itself has strict headers.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './media-helpers.mjs';
import { hashPassword } from '../functions/api/_lib/password.js';
import { parseTicketInput } from '../functions/api/_lib/gateTicketNumber.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const T = Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z]/g, 'Q');
const SA_EMAIL = `gc-sa-${T.toLowerCase()}@example.com`, SA_PW = 'Gate-Super-2026!';
const STEW = { staffId: `LSG-${T}1`, name: 'Chidi Steward', role: 'steward', password: 'Turnstile-Blue-41' };
const SUP = { staffId: `LSG-${T}2`, name: 'Ngozi Lead', role: 'supervisor', password: 'Floodlight-Red-52' };
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const tid = () => `LS-TIX-${Array.from({ length: 12 }, () => CH[(Math.random() * CH.length) | 0]).join('')}`;
const EV = `gc-ev-${T}`, EV2 = `gc-ev2-${T}`;
const K = { a: tid(), b: tid(), c: tid(), race: tid(), tomorrow: tid(), refunded: tid(), unpaid: tid() };

async function signIn(login, password) {
  const r = await fetch(`${BASE}/api/gate-control/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ login, password }) });
  const cookie = (r.headers.get('set-cookie') || '').match(/ls_gate=([^;]+)/)?.[1];
  return { status: r.status, data: await r.json().catch(() => ({})), cookie };
}
async function as(cookie) {
  const s = await fetch(`${BASE}/api/gate-control/session`, { headers: { Cookie: `ls_gate=${cookie}` } }).then(r => r.json());
  const call = (path, body) => fetch(`${BASE}/api/gate-control/${path}`, body ? { method: 'POST', headers: { Cookie: `ls_gate=${cookie}`, 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf }, body: JSON.stringify(body) } : { headers: { Cookie: `ls_gate=${cookie}` } })
    .then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
  return { s, call };
}
let A, St, Su;

after(() => sql(`DELETE FROM tickets WHERE event_id IN ('${EV}', '${EV2}'); DELETE FROM orders WHERE event_id IN ('${EV}', '${EV2}'); DELETE FROM events WHERE id IN ('${EV}', '${EV2}');
  DELETE FROM admin_users WHERE email = '${SA_EMAIL}'; DELETE FROM gc_staff WHERE staff_id IN ('${STEW.staffId}', '${SUP.staffId}');`));

test('ticket numbers and QR codes are read correctly', () => {
  const id = K.a;
  assert.deepEqual(parseTicketInput(id), { id });
  assert.deepEqual(parseTicketInput(id.toLowerCase()), { id });
  assert.deepEqual(parseTicketInput(id.slice(7)), { id }, 'typed without LS-TIX-');
  assert.deepEqual(parseTicketInput(`https://lobistarsfc.com/verify/${id}`), { id });
  assert.equal(parseTicketInput(`https://evil.example.com/verify/${id}`).code, 'not_lobi');
  assert.equal(parseTicketInput('hello world').code, 'not_lobi');
  assert.equal(parseTicketInput('LS-TIX-ABCD0EFGH1JK').code, 'bad_number', '0 and 1 are never used');
  assert.equal(parseTicketInput('LS-TIX-ABC').code, 'bad_number');
});

test('own sign-in; stewards cannot open /admin or manage staff; a gate must be chosen', async () => {
  sql(`INSERT INTO admin_users (id, name, email, password_hash, role, active, test_account) VALUES ('gct_${T}', 'Gate Super Tester', '${SA_EMAIL}', '${await hashPassword(SA_PW)}', 'super_admin', 1, 1);`);
  const sa = await signIn(SA_EMAIL, SA_PW);
  assert.equal(sa.status, 200, JSON.stringify(sa.data));
  A = await as(sa.cookie);
  assert.equal(A.s.perms.staff, true);
  for (const p of [STEW, SUP]) assert.equal((await A.call('staff', { action: 'add', ...p })).status, 200, `adds ${p.name}`);
  assert.match((await A.call('staff', { action: 'add', staffId: `LSG-${T}9`, name: 'Weak', role: 'steward', password: 'tickets123' })).data.error, /common/);
  assert.equal((await A.call('staff', { action: 'gates', gates: ['Main Gate', 'VIP Gate', 'Gate C'] })).data.gates.length, 3);

  const st = await signIn(STEW.staffId.toLowerCase(), STEW.password);
  assert.equal(st.status, 200, JSON.stringify(st.data));
  assert.equal((await fetch(`${BASE}/api/admin/me`, { headers: { Cookie: `ls_gate=${st.cookie}` } })).status, 401, 'a Gate Control session never opens /admin');
  St = await as(st.cookie);
  assert.equal(St.s.perms.readmit, false);
  assert.equal((await St.call('staff')).status, 403);
  assert.equal((await St.call('check', { ticket: K.a })).data.needGate, true);
  assert.equal((await St.call('gate', { gate: 'Nowhere' })).status, 400);
  assert.equal((await St.call('gate', { gate: 'Main Gate' })).data.gate, 'Main Gate');
  Su = await as((await signIn(SUP.staffId, SUP.password)).cookie);
  await Su.call('gate', { gate: 'VIP Gate' });
  assert.equal((await signIn(STEW.staffId, 'wrong-password-1')).status, 401);
});

test('scan / type: details shown; checked in once; fake, used, wrong match, cancelled and unpaid refused', async () => {
  const now = new Date(Date.now() + 20 * 60e3).toISOString(), later = new Date(Date.now() + 3 * 86400e3).toISOString();
  const ord = (id, ev, tier, status, extra = '') => `INSERT INTO orders (id, event_id, buyer_name, buyer_email, buyer_phone, tier, quantity, unit_price_kobo, total_kobo, paystack_reference, payment_status, paid_at, source, city, region, device${extra ? ', refunded_at' : ''})
    VALUES ('${id}', '${ev}', 'Terver Iorliam', 'terver.${T.toLowerCase()}@example.com', '2348031234567', '${tier}', 2, 150000, 300000, 'ref-${id}', '${status}', datetime('now', '-2 day'), 'Instagram', 'Makurdi', 'Benue', 'Phone'${extra ? `, datetime('now')` : ''});`;
  const tk = (id, o, ev, tier) => `INSERT INTO tickets (id, order_id, event_id, tier, status) VALUES ('${id}', '${o}', '${ev}', '${tier}', 'valid');`;
  sql(`INSERT INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo, active) VALUES ('${EV}', 'Lobi Stars FC', 'Gate Test ${T}', 'NNL', '${now}', 'McCarthy Stadium', 150000, 80000, 40000, 1);
    INSERT INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo, active) VALUES ('${EV2}', 'Lobi Stars FC', 'Later Test ${T}', 'NNL', '${later}', 'McCarthy Stadium', 150000, 80000, 40000, 1);
    ${ord(`gco1-${T}`, EV, 'VIP', 'paid')} ${tk(K.a, `gco1-${T}`, EV, 'VIP')} ${tk(K.b, `gco1-${T}`, EV, 'VIP')}
    ${ord(`gco2-${T}`, EV, 'Regular', 'paid')} ${tk(K.c, `gco2-${T}`, EV, 'Regular')} ${tk(K.race, `gco2-${T}`, EV, 'Regular')}
    ${ord(`gco3-${T}`, EV2, 'Premium', 'paid')} ${tk(K.tomorrow, `gco3-${T}`, EV2, 'Premium')}
    ${ord(`gco4-${T}`, EV, 'VIP', 'paid', 'refunded')} ${tk(K.refunded, `gco4-${T}`, EV, 'VIP')}
    ${ord(`gco5-${T}`, EV, 'VIP', 'pending')} ${tk(K.unpaid, `gco5-${T}`, EV, 'VIP')}`);

  // Look up only: everything shown, not checked in.
  let r = (await St.call('check', { ticket: K.a, mode: 'lookup', how: 'typed' })).data;
  assert.equal(r.code, 'valid', JSON.stringify(r));
  assert.equal(r.ticket.buyer, 'Terver Iorliam'); assert.equal(r.ticket.stand, 'VIP Sitting'); assert.equal(r.ticket.pricePaidKobo, 150000);
  assert.equal(r.ticket.where.source, 'Instagram'); assert.equal(r.ticket.where.place, 'Makurdi, Benue'); assert.ok(r.ticket.boughtAt);
  assert.equal(r.ticket.phone, '0803 *** 4567', 'phone partly hidden');
  assert.equal(r.ticket.status, 'valid');

  // Check in (QR code with the verify link).
  r = (await St.call('check', { ticket: `https://lobistarsfc.com/verify/${K.a}`, how: 'camera' })).data;
  assert.equal(r.code, 'admitted', JSON.stringify(r)); assert.equal(r.title, 'ADMIT');
  // Again, at another gate: refused, with when, where and by whom.
  r = (await Su.call('check', { ticket: K.a })).data;
  assert.equal(r.code, 'used'); assert.match(r.reason, /Main Gate/); assert.match(r.reason, /Chidi Steward/);
  // Typed without LS-TIX-.
  assert.equal((await St.call('check', { ticket: K.b.slice(7), how: 'typed' })).data.code, 'admitted');

  assert.equal((await St.call('check', { ticket: tid() })).data.code, 'fake');
  const nl = (await St.call('check', { ticket: 'https://scam.example.com/ticket/123' })).data;
  assert.equal(nl.code, 'not_lobi'); assert.equal(nl.fake, true);
  const wm = (await St.call('check', { ticket: K.tomorrow })).data;
  assert.equal(wm.code, 'wrong_match'); assert.match(wm.reason, /Later Test/);
  assert.equal((await St.call('check', { ticket: K.refunded })).data.code, 'void');
  assert.equal((await St.call('check', { ticket: K.unpaid })).data.code, 'unpaid');

  // Five phones scan the same ticket at the same moment: exactly one admits it.
  const all = await Promise.all([St, Su, St, Su, St].map(x => x.call('check', { ticket: K.race })));
  assert.equal(all.filter(x => x.data.code === 'admitted').length, 1, all.map(x => x.data.code).join(','));
  assert.equal(all.filter(x => x.data.code === 'used').length, 4);
  assert.equal(JSON.parse(sql(`SELECT status FROM tickets WHERE id = '${K.race}'`))[0].results[0].status, 'used');
});

test('re-admit (supervisors only, with a reason); today view; activity recorded; page headers', async () => {
  assert.equal((await St.call('readmit', { ticket: K.a, reason: 'Went to the car' })).status, 403);
  assert.equal((await Su.call('readmit', { ticket: K.a, reason: '' })).status, 400);
  assert.equal((await Su.call('readmit', { ticket: K.c, reason: 'Went to the car' })).status, 400, 'only a used ticket');
  const r = await Su.call('readmit', { ticket: K.a, reason: 'Went to the car park' });
  assert.equal(r.data.code, 'readmitted', JSON.stringify(r.data));

  const d = (await St.call('today')).data;
  assert.ok(d.totals.admitted >= 4); assert.ok(d.totals.fake >= 2); assert.ok(d.byGate.some(g => g.gate === 'Main Gate'));
  assert.ok(d.latest.some(s => s.result === 'readmitted' && /car park/.test(s.note)));
  assert.ok(d.onDuty.some(p => p.code === STEW.staffId && p.gate === 'Main Gate'));
  // Counts per steward (each on their own phone), per gate and together; "You" marked.
  const me = d.byStaff.find(x => x.code === STEW.staffId), sup = d.byStaff.find(x => x.code === SUP.staffId);
  assert.ok(me.me, 'my row is marked'); assert.equal(sup.me, false);
  assert.ok(me.admitted >= 2); assert.equal(me.gate, 'Main Gate'); assert.ok(me.refused >= 1);
  assert.equal(d.byStaff.reduce((t, x) => t + x.admitted, 0), d.totals.admitted, 'the stewards add up to the total');
  assert.ok(d.timeline.length >= 1 && d.timeline.reduce((t, x) => t + x.n, 0) === d.totals.admitted);
  const c = (await St.call('counts')).data, c2 = (await Su.call('counts')).data;
  assert.equal(c.me, me.admitted); assert.equal(c.gate.name, 'Main Gate'); assert.equal(c.total, d.totals.admitted);
  assert.equal(c2.me, sup.admitted); assert.equal(c2.gate.name, 'VIP Gate'); assert.equal(c2.total, c.total);

  const mine = (await St.call(`activity?day=`)).data;
  assert.equal(mine.all, false); assert.ok(mine.rows.every(a => a.code === STEW.staffId));
  assert.ok(mine.rows.some(a => /Refused: fake ticket/.test(a.action)));
  const all = (await Su.call('activity?day=')).data;
  assert.equal(all.all, true); assert.ok(all.rows.some(a => /Re-admitted/.test(a.action)));
  assert.equal((await fetch(`${BASE}/api/gate-control/activity?format=csv`, { headers: { Cookie: `ls_gate=x` } })).status, 401);

  const page = await fetch(`${BASE}/gate-control/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('permissions-policy') || '', /camera=\(self\)/);
  assert.match(page.headers.get('content-security-policy') || '', /script-src 'self'/);
  assert.match(page.headers.get('x-robots-tag') || '', /noindex/);
  assert.equal((await fetch(`${BASE}/gate-control/anything`)).status, 404);
  assert.equal((await fetch(`${BASE}/vendor/html5-qrcode-2.3.8.min.js`)).status, 200);

  // Switching a steward off signs them out straight away.
  const sid = (await A.call('staff')).data.staff.find(s => s.staffId === STEW.staffId).id;
  assert.equal((await A.call('staff', { action: 'edit', id: sid, active: false })).status, 200);
  assert.equal((await St.call('check', { ticket: K.c })).status, 401);
});
