// Lobi Gate Control (/gate-control): the ticket scanners. A scanner (phone / laptop) is
// added in the admin and switched on once with a one-time passcode (no email or password),
// stays on until revoked, and never opens the admin back end; a gate must be chosen; scanning or typing
// a ticket shows who bought it, when, where and the price, and checks them in
// once only (also when five phones scan the same ticket at once); fake, used,
// wrong-match, cancelled and unpaid tickets are refused; supervisors re-admit;
// everything is recorded; the page itself has strict headers.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './media-helpers.mjs';
import { parseTicketInput } from '../functions/api/_lib/gateTicketNumber.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const T = Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z]/g, 'Q');
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const adm = body => fetch(`${BASE}/api/admin/gate-control`, body ? { method: 'POST', headers: ADMIN, body: JSON.stringify(body) } : { headers: ADMIN }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
// Scanners: filled in when they are added (code SCN-…, the phone's cookie).
const STEW = { name: `Main Gate phone ${T}`, holder: 'Chidi Steward', role: 'steward' };
const SUP = { name: `VIP Gate phone ${T}`, holder: 'Ngozi Lead', role: 'supervisor' };
const OBS = { name: `Gate C phone ${T}`, holder: 'Observer', role: 'steward' };
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const tid = () => `LS-TIX-${Array.from({ length: 12 }, () => CH[(Math.random() * CH.length) | 0]).join('')}`;
const EV = `gc-ev-${T}`, EV2 = `gc-ev2-${T}`;
const K = { a: tid(), b: tid(), c: tid(), d: tid(), race: tid(), tomorrow: tid(), refunded: tid(), unpaid: tid() };

async function activate(passcode) {
  const r = await fetch(`${BASE}/api/gate-control/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ passcode }) });
  const cookie = (r.headers.get('set-cookie') || '').match(/ls_gate=([^;]+)/)?.[1];
  return { status: r.status, data: await r.json().catch(() => ({})), cookie };
}
async function as(cookie) {
  const s = await fetch(`${BASE}/api/gate-control/session`, { headers: { Cookie: `ls_gate=${cookie}` } }).then(r => r.json());
  const call = (path, body) => fetch(`${BASE}/api/gate-control/${path}`, body ? { method: 'POST', headers: { Cookie: `ls_gate=${cookie}`, 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf }, body: JSON.stringify(body) } : { headers: { Cookie: `ls_gate=${cookie}` } })
    .then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
  return { s, call, cookie };
}
let St, Su;
const ids = [];

after(() => sql(`DELETE FROM tickets WHERE event_id IN ('${EV}', '${EV2}'); DELETE FROM orders WHERE event_id IN ('${EV}', '${EV2}'); DELETE FROM events WHERE id IN ('${EV}', '${EV2}');
  DELETE FROM gc_devices WHERE id IN (${ids.map(i => `'${i}'`).join(', ') || "''"});`));

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

test('scanners: added in the admin, switched on once with a passcode, never /admin; a gate must be chosen', async () => {
  assert.equal((await adm({ action: 'gates', gates: ['Main Gate', 'VIP Gate', 'Gate C'] })).data.gates.length, 3);
  for (const d of [STEW, SUP, OBS]) {
    const r = await adm({ action: 'add', ...d, gate: d === SUP ? 'VIP Gate' : '' }); // a supervisor's gate is ignored: all gates
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.match(r.data.passcode, /^\d{4}-\d{4}$/); assert.match(r.data.code, /^SCN-\d{3}/);
    Object.assign(d, { code: r.data.code, id: r.data.id, passcode: r.data.passcode }); ids.push(r.data.id);
  }
  assert.equal((await adm({ action: 'add', name: '' })).status, 400);
  // Wrong passcode refused; the right one works once only.
  assert.equal((await activate('0000-0001')).status, 401);
  const st = await activate(STEW.passcode);
  assert.equal(st.status, 200, JSON.stringify(st.data)); STEW.cookie = st.cookie;
  assert.match((await activate(STEW.passcode)).data.error, /already been used/);
  assert.equal((await fetch(`${BASE}/api/admin/me`, { headers: { Cookie: `ls_gate=${st.cookie}` } })).status, 401, 'a scanner never opens /admin');
  St = await as(st.cookie);
  assert.equal(St.s.user.code, STEW.code); assert.equal(St.s.user.kind, 'device'); assert.equal(St.s.perms.readmit, false);
  assert.equal((await St.call('check', { ticket: K.a })).data.needGate, true);
  assert.equal((await St.call('gate', { gate: 'Nowhere' })).status, 400);
  assert.equal((await St.call('gate', { gate: 'Main Gate' })).data.gate, 'Main Gate');
  const su = await activate(SUP.passcode); SUP.cookie = su.cookie;
  Su = await as(su.cookie);
  assert.equal(Su.s.user.gate, 'All gates', 'supervisors have all gates'); assert.equal(Su.s.user.allGates, true); assert.equal(Su.s.perms.readmit, true);
  assert.equal((await Su.call('gate', { gate: 'Main Gate' })).status, 400, 'a supervisor does not choose a gate');
  // The admin sees them: active now, waiting for a passcode.
  const v = (await adm()).data;
  assert.ok(v.activeNow >= 2);
  const row = code => v.devices.find(x => x.code === code);
  assert.equal(row(STEW.code).online, true); assert.equal(row(STEW.code).status, 'active'); assert.equal(row(OBS.code).status, 'waiting');
});

test('scan / type: details shown; checked in once; fake, used, wrong match, cancelled and unpaid refused', async () => {
  const now = new Date(Date.now() + 20 * 60e3).toISOString(), later = new Date(Date.now() + 3 * 86400e3).toISOString();
  const ord = (id, ev, tier, status, extra = '') => `INSERT INTO orders (id, event_id, buyer_name, buyer_email, buyer_phone, tier, quantity, unit_price_kobo, total_kobo, paystack_reference, payment_status, paid_at, source, city, region, device${extra ? ', refunded_at' : ''})
    VALUES ('${id}', '${ev}', 'Terver Iorliam', 'terver.${T.toLowerCase()}@example.com', '2348031234567', '${tier}', 2, 150000, 300000, 'ref-${id}', '${status}', datetime('now', '-2 day'), 'Instagram', 'Makurdi', 'Benue', 'Phone'${extra ? `, datetime('now')` : ''});`;
  const tk = (id, o, ev, tier) => `INSERT INTO tickets (id, order_id, event_id, tier, status) VALUES ('${id}', '${o}', '${ev}', '${tier}', 'valid');`;
  sql(`INSERT INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo, active) VALUES ('${EV}', 'Lobi Stars FC', 'Gate Test ${T}', 'NNL', '${now}', 'McCarthy Stadium', 150000, 80000, 40000, 1);
    INSERT INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo, active) VALUES ('${EV2}', 'Lobi Stars FC', 'Later Test ${T}', 'NNL', '${later}', 'McCarthy Stadium', 150000, 80000, 40000, 1);
    ${ord(`gco1-${T}`, EV, 'VIP', 'paid')} ${tk(K.a, `gco1-${T}`, EV, 'VIP')} ${tk(K.b, `gco1-${T}`, EV, 'VIP')}
    ${ord(`gco2-${T}`, EV, 'Regular', 'paid')} ${tk(K.c, `gco2-${T}`, EV, 'Regular')} ${tk(K.race, `gco2-${T}`, EV, 'Regular')} ${tk(K.d, `gco2-${T}`, EV, 'Regular')}
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
  assert.ok(d.onDuty.some(p => p.code === STEW.code && p.gate === 'Main Gate'));
  // Counts per steward (each on their own phone), per gate and together; "You" marked.
  const me = d.byStaff.find(x => x.id === STEW.id), sup = d.byStaff.find(x => x.id === SUP.id);
  assert.ok(me.me, 'my row is marked'); assert.equal(sup.me, false);
  assert.ok(me.admitted >= 2); assert.equal(me.gate, 'Main Gate'); assert.ok(me.refused >= 1);
  assert.equal(d.byStaff.reduce((t, x) => t + x.admitted, 0), d.totals.admitted, 'the stewards add up to the total');
  assert.ok(d.timeline.length >= 1 && d.timeline.reduce((t, x) => t + x.n, 0) === d.totals.admitted);
  const c = (await St.call('counts')).data, c2 = (await Su.call('counts')).data;
  assert.equal(c.me, me.admitted); assert.equal(c.gate.name, 'Main Gate'); assert.equal(c.total, d.totals.admitted);
  assert.equal(c2.me, sup.admitted); assert.equal(c2.gate.name, 'All gates'); assert.equal(c2.gate.admitted, c.total, 'all gates = everyone'); assert.equal(c2.total, c.total);

  const mine = (await St.call(`activity?day=`)).data;
  assert.equal(mine.all, false); assert.ok(mine.rows.every(a => a.code === STEW.code));
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
  assert.equal((await fetch(`${BASE}/vendor/jsqr-1.4.0.min.js`)).status, 200);

  // Switching a steward off signs them out straight away.
  // Revoking a scanner stops it at once; a new passcode switches it on again.
  assert.equal((await adm({ action: 'revoke', id: STEW.id })).status, 200);
  assert.equal((await adm()).data.devices.find(x => x.code === STEW.code).status, 'revoked');
  assert.equal((await St.call('check', { ticket: K.c })).status, 401);
});

test('wrong gate (admit anyway), offline list and sync with double entries, messages, incidents, report', async () => {
  // Main Gate is for VIP only; the other gates take every stand.
  assert.match((await adm({ action: 'stands', stands: { 'Main Gate': ['VIP'], 'VIP Gate': ['VIP'], 'Gate C': ['VIP'] } })).data.error, /No gate is left/);
  assert.equal((await adm({ action: 'stands', stands: { 'Main Gate': ['VIP'], 'VIP Gate': [], 'Gate C': [] } })).status, 200);
  const sup = { cookie: SUP.cookie };
  const U = await as(sup.cookie);
  // A steward set to a gate by the club stays at it (cannot change it on the phone).
  const A = await as((await activate(OBS.passcode)).cookie);
  assert.equal((await adm({ action: 'edit', id: OBS.id, gate: 'Main Gate' })).status, 200);
  const A2 = await as(A.cookie);
  assert.equal(A2.s.user.gate, 'Main Gate'); assert.equal(A2.s.user.gateLocked, true);
  assert.equal((await A.call('gate', { gate: 'Gate C' })).status, 400, 'locked to the gate set by the club');
  const wg = (await A.call('check', { ticket: K.d })).data;
  assert.equal(wg.code, 'wrong_gate', JSON.stringify(wg)); assert.ok(wg.goTo.includes('VIP Gate')); assert.equal(wg.canOverride, true);
  assert.equal(JSON.parse(sql(`SELECT status FROM tickets WHERE id = '${K.d}'`))[0].results[0].status, 'valid', 'not checked in');
  // A supervisor (all gates) is never sent to another gate.
  assert.equal((await U.call('check', { ticket: K.d })).data.code, 'admitted', 'supervisor admits at any gate');
  // Back to "they choose", then the steward picks Gate C.
  assert.equal((await adm({ action: 'edit', id: OBS.id, gate: '' })).status, 200);
  assert.equal((await A.call('gate', { gate: 'Gate C' })).status, 200);
  await adm({ action: 'stands', stands: { 'Main Gate': [], 'VIP Gate': [], 'Gate C': [] } });

  // Offline list: no phone numbers or emails, just number, stand, child, first name, already in.
  const pack = (await U.call('offline')).data;
  assert.ok(Array.isArray(pack.tickets)); assert.ok(pack.stands);
  if (pack.match?.id === EV) {
    const row = pack.tickets.find(r => r[0] === K.c);
    assert.deepEqual(row, [K.c, 'Regular', 0, 'Terver', 0]);
    assert.equal(pack.tickets.find(r => r[0] === K.a)[4], 1, 'already in');
    assert.ok(!JSON.stringify(pack).includes('example.com'), 'no emails on the phone');
  }
  // Offline check-ins sent later: K.c is new; K.a had already been checked in = double entry.
  const at = new Date(Date.now() - 5 * 60e3).toISOString();
  const s1 = (await U.call('sync', { scans: [{ ticket: K.c, at }, { ticket: K.a, at }] })).data;
  assert.equal(s1.sent, 2); assert.equal(s1.admitted, 1); assert.deepEqual(s1.doubles, [K.a]);
  const s2 = (await U.call('sync', { scans: [{ ticket: K.c, at }] })).data;
  assert.equal(s2.admitted, 1, 'sent twice (lost answer): not a double entry'); assert.equal(s2.doubles.length, 0);
  const today = (await U.call('today')).data;
  assert.ok(today.watch.doubles.some(x => x.ticket === K.a)); assert.ok(today.watch.repeats.some(x => x.ticket === K.a));

  // Messages from a supervisor reach every gate (or one gate); taken down again.
  assert.equal((await U.call('message', { action: 'send', text: 'Gate C closed: send fans to Main Gate', gate: '' })).status, 200);
  let c = (await A.call('counts')).data;
  const msg = c.messages.find(m => /Gate C closed/.test(m.text));
  assert.ok(msg);
  assert.equal((await U.call('message', { action: 'send', text: 'Only VIP Gate sees this', gate: 'VIP Gate' })).status, 200);
  assert.ok(!(await A.call('counts')).data.messages.some(m => /Only VIP/.test(m.text)), 'Gate C does not see a VIP Gate message');
  assert.ok((await U.call('counts')).data.messages.some(m => /Only VIP/.test(m.text)), 'a supervisor (all gates) sees every message');
  assert.equal((await U.call('message', { action: 'clear', id: msg.id })).status, 200);
  assert.ok(!(await A.call('counts')).data.messages.some(m => m.id === msg.id));

  // Incidents: reported, listed, closed by a supervisor.
  assert.equal((await U.call('incident', { action: 'add', category: 'nope', details: 'x' })).status, 400);
  const inc = (await U.call('incident', { action: 'add', category: 'medical', details: 'Fan fainted near turnstile 2, first aid called', ticket: K.c })).data;
  assert.ok(inc.id);
  assert.ok((await U.call('counts')).data.openIncidents >= 1);
  const list = (await U.call('incidents')).data;
  assert.ok(list.incidents.some(i => i.id === inc.id && i.open && i.label === 'Medical / first aid'));
  assert.equal((await U.call('incident', { action: 'close', id: inc.id, note: 'Taken to first aid room' })).status, 200);
  assert.ok((await U.call('incidents')).data.incidents.some(i => i.id === inc.id && !i.open && /first aid room/.test(i.closeNote)));

  // End-of-day report for supervisors.
  const rep = await fetch(`${BASE}/api/gate-control/report`, { headers: { Cookie: `ls_gate=${sup.cookie}` } });
  assert.equal(rep.status, 200); const csv = await rep.text();
  assert.match(csv, /Time \(Nigeria\),Result,Ticket/); assert.ok(csv.includes(K.a)); assert.match(csv, /Sent to another gate/);
  // The app files.
  assert.equal((await fetch(`${BASE}/gate-control/sw.js`)).headers.get('service-worker-allowed'), '/gate-control/');
  assert.equal((await fetch(`${BASE}/gate-control.webmanifest`)).status, 200);
});
