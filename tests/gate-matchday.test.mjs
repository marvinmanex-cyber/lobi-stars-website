// Lobi Gate Control match-day running: gates open / closed, stand capacity (90% / full),
// banned list (DO NOT ADMIT + incident), practice mode (nothing counted), staff passes
// (LS-ACC-…, zones, withdrawn), a message to one scanner, scanner readiness (battery,
// camera, offline list), queue speed and the match-day report.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './media-helpers.mjs';
import { parseTicketInput } from '../functions/api/_lib/gateTicketNumber.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const T = Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z]/g, 'Q');
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const adm = (body, q = '') => fetch(`${BASE}/api/admin/gate-control${q}`, body ? { method: 'POST', headers: ADMIN, body: JSON.stringify(body) } : { headers: ADMIN })
  .then(async r => ({ status: r.status, data: await r.clone().json().catch(() => ({})), text: await r.text().catch(() => '') }));
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const tid = () => `LS-TIX-${Array.from({ length: 12 }, () => CH[(Math.random() * CH.length) | 0]).join('')}`;
const EV = `gm-ev-${T}`;
const K = { a: tid(), b: tid(), f: tid(), g: tid(), d: tid(), e: tid(), h: tid(), vip: tid() };
const BAN_EMAIL = `banned.${T.toLowerCase()}@example.com`;
const ids = [], passes = [];

async function device(role, name) {
  const r = await adm({ action: 'add', name: `${name} ${T}`, holder: name, role, gate: '' });
  assert.equal(r.status, 200, JSON.stringify(r.data)); ids.push(r.data.id);
  const a = await fetch(`${BASE}/api/gate-control/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ passcode: r.data.passcode }) });
  const cookie = (a.headers.get('set-cookie') || '').match(/ls_gate=([^;]+)/)?.[1];
  const s = await fetch(`${BASE}/api/gate-control/session`, { headers: { Cookie: `ls_gate=${cookie}` } }).then(x => x.json());
  const call = (path, body) => fetch(`${BASE}/api/gate-control/${path}`, body ? { method: 'POST', headers: { Cookie: `ls_gate=${cookie}`, 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf }, body: JSON.stringify(body) } : { headers: { Cookie: `ls_gate=${cookie}` } })
    .then(async x => ({ status: x.status, data: await x.json().catch(() => ({})) }));
  return { id: r.data.id, code: r.data.code, s, call };
}
const status = id => JSON.parse(sql(`SELECT status FROM tickets WHERE id = '${id}'`))[0].results[0].status;
let St, Su;

after(() => sql(`DELETE FROM tickets WHERE event_id = '${EV}'; DELETE FROM orders WHERE event_id = '${EV}'; DELETE FROM events WHERE id = '${EV}';
  DELETE FROM gc_devices WHERE id IN (${ids.map(i => `'${i}'`).join(', ') || "''"}); DELETE FROM gc_passes WHERE id IN (${passes.map(i => `'${i}'`).join(', ') || "''"});
  DELETE FROM gc_banned WHERE value IN ('${BAN_EMAIL}', '${K.e}'); DELETE FROM gc_settings WHERE key IN ('gates_state', 'stand_capacity', 'report_emails');`));

test('passes and media cards are read from QR codes', () => {
  assert.deepEqual(parseTicketInput('LS-ACC-ABCD2345EFGH'), { id: 'LS-ACC-ABCD2345EFGH' });
  assert.deepEqual(parseTicketInput('https://lobistarsfc.com/media/verify/AbC123xyz_-9'), { media: 'AbC123xyz_-9' });
  assert.deepEqual(parseTicketInput('https://lobistarsfc.com/media/accreditation/verify/AbC123xyz_-9'), { media: 'AbC123xyz_-9' });
  assert.equal(parseTicketInput('https://evil.example.com/media/verify/AbC123xyz_-9').code, 'not_lobi');
});

test('set-up: today\'s home match, scanners at a gate', async () => {
  const ko = new Date(Date.now() + 30 * 60e3).toISOString();
  const ord = (id, tier, email) => `INSERT INTO orders (id, event_id, buyer_name, buyer_email, buyer_phone, tier, quantity, unit_price_kobo, total_kobo, paystack_reference, payment_status, paid_at)
    VALUES ('${id}', '${EV}', 'Msughter Test', '${email}', '0803 555 ${T.length}${T.length}${T.length}${T.length}', '${tier}', 1, 40000, 40000, 'ref-${id}', 'paid', datetime('now', '-1 day'));`;
  const tk = (id, o, tier) => `INSERT INTO tickets (id, order_id, event_id, tier, status) VALUES ('${id}', '${o}', '${EV}', '${tier}', 'valid');`;
  sql(`DELETE FROM gc_settings WHERE key LIKE 'cap_alerts_%' OR key IN ('gates_state', 'stand_capacity');
    INSERT INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo, active) VALUES ('${EV}', 'Lobi Stars FC', 'Matchday Test ${T}', 'NNL', '${ko}', 'McCarthy Stadium', 150000, 80000, 40000, 1);
    ${ord(`gmo1-${T}`, 'Regular', `fan.${T.toLowerCase()}@example.com`)} ${tk(K.a, `gmo1-${T}`, 'Regular')} ${tk(K.b, `gmo1-${T}`, 'Regular')} ${tk(K.f, `gmo1-${T}`, 'Regular')} ${tk(K.g, `gmo1-${T}`, 'Regular')} ${tk(K.h, `gmo1-${T}`, 'Regular')} ${tk(K.e, `gmo1-${T}`, 'Regular')}
    ${ord(`gmo2-${T}`, 'Regular', BAN_EMAIL)} ${tk(K.d, `gmo2-${T}`, 'Regular')}
    ${ord(`gmo3-${T}`, 'VIP', `vip.${T.toLowerCase()}@example.com`)} ${tk(K.vip, `gmo3-${T}`, 'VIP')}`);
  St = await device('steward', 'Gate steward'); Su = await device('supervisor', 'Gate lead');
  assert.equal((await St.call('gate', { gate: St.s.gates[0] })).status, 200);
});

test('gates closed / not open yet: stewards refused, a supervisor can let someone in', async () => {
  assert.equal((await adm({ action: 'gates_mode', mode: 'closed' })).status, 200);
  let r = (await St.call('check', { ticket: K.a })).data;
  assert.equal(r.code, 'gates_closed', JSON.stringify(r)); assert.equal(r.canForce, false); assert.equal(status(K.a), 'valid');
  assert.equal((await St.call('check', { ticket: K.a, force: true })).status, 403, 'stewards cannot force');
  assert.equal((await St.call('check', { ticket: K.a, mode: 'lookup' })).data.code, 'valid', 'look-ups still work');
  r = (await Su.call('check', { ticket: K.a })).data;
  assert.equal(r.code, 'gates_closed'); assert.equal(r.canForce, true);
  assert.equal((await Su.call('check', { ticket: K.a, force: true })).data.code, 'admitted');
  // Automatic: opens 15 minutes before a kick-off 30 minutes away = not open yet.
  assert.equal((await adm({ action: 'gates_mode', mode: 'auto', openBefore: 15 })).status, 200);
  const v = (await adm()).data;
  assert.equal(v.gatesState.open, false); assert.equal(v.gatesState.mode, 'auto'); assert.match(v.gatesState.label, /Opening at/);
  r = (await St.call('check', { ticket: K.b })).data;
  assert.equal(r.code, 'gates_closed'); assert.equal(r.title, 'GATES NOT OPEN YET');
  assert.equal((await St.call('counts')).data.gates.open, false);
  // Open by hand: checked in, and every gate gets a message.
  assert.equal((await adm({ action: 'gates_mode', mode: 'open' })).data.gates.open, true);
  assert.equal((await St.call('check', { ticket: K.b })).data.code, 'admitted');
  assert.ok((await St.call('counts')).data.messages.some(m => /gates are now OPEN/.test(m.text)));
  assert.equal((await adm({ action: 'gates_mode', mode: 'auto', openBefore: 180 })).data.gates.open, true);
});

test('stand capacity: message at full, then STAND FULL (supervisor can still let in)', async () => {
  const before = (await adm()).data.capacity.find(c => c.tier === 'Regular').inside;
  assert.equal((await adm({ action: 'capacity', capacity: { Regular: String(before + 1), VIP: '', Premium: '' } })).status, 200);
  assert.equal((await St.call('check', { ticket: K.f })).data.code, 'admitted');
  const cap = (await adm()).data.capacity.find(c => c.tier === 'Regular');
  assert.equal(cap.state, 'full'); assert.equal(cap.inside, before + 1);
  assert.ok((await St.call('counts')).data.messages.some(m => /Popular Stand is FULL/.test(m.text)), 'every gate told');
  const r = (await St.call('check', { ticket: K.g })).data;
  assert.equal(r.code, 'stand_full', JSON.stringify(r)); assert.equal(status(K.g), 'valid');
  assert.equal((await St.call('check', { ticket: K.vip })).data.code, 'admitted', 'other stands carry on');
  assert.equal((await Su.call('check', { ticket: K.g, force: true })).data.code, 'admitted');
  assert.equal((await adm({ action: 'capacity', capacity: {} })).status, 200);
});

test('banned list: DO NOT ADMIT, incident for supervisors, offline list; removed = admitted', async () => {
  assert.equal((await adm({ action: 'ban_add', value: 'nonsense', reason: 'x y z' })).status, 400);
  assert.equal((await adm({ action: 'ban_add', value: BAN_EMAIL.toUpperCase(), name: 'Banned Fan', reason: 'Crowd trouble' })).status, 200);
  assert.equal((await adm({ action: 'ban_add', value: K.e.toLowerCase(), reason: 'Ticket resold by a tout' })).status, 200);
  const inc0 = (await Su.call('counts')).data.openIncidents;
  let r = (await St.call('check', { ticket: K.d })).data;
  assert.equal(r.code, 'banned'); assert.equal(r.title, 'DO NOT ADMIT'); assert.match(r.reason, /Crowd trouble/); assert.equal(status(K.d), 'valid');
  assert.equal((await St.call('check', { ticket: K.e })).data.code, 'banned');
  assert.ok((await Su.call('counts')).data.openIncidents >= inc0 + 1, 'supervisors alerted');
  const pack = (await St.call('offline')).data;
  if (pack.match?.id === EV) { assert.ok(pack.banned.includes(K.d)); assert.ok(pack.banned.includes(K.e)); }
  const v = (await adm()).data;
  assert.ok(v.watch.banned.some(x => x.ticket === K.d));
  const ban = v.bans.find(b => b.kind === 'email' && /^ba\*\*\*@example\.com$/.test(b.value));
  assert.ok(ban, 'emails are masked in the list');
  assert.equal((await adm({ action: 'ban_remove', id: ban.id })).status, 200);
  assert.equal((await St.call('check', { ticket: K.d })).data.code, 'admitted');
});

test('practice mode: same answers, nothing checked in or counted; practice tickets refused for real', async () => {
  const c0 = (await St.call('counts')).data.total;
  let r = (await St.call('check', { ticket: K.h, practice: true })).data;
  assert.equal(r.code, 'admitted'); assert.equal(r.practice, true); assert.equal(status(K.h), 'valid', 'not checked in');
  r = (await St.call('check', { ticket: 'TEST7STAND77', practice: true })).data;
  assert.equal(r.code, 'wrong_gate'); assert.equal(r.practice, true);
  assert.equal((await St.call('check', { ticket: 'LS-TIX-TEST8BANNED8', practice: true })).data.code, 'banned');
  assert.equal((await St.call('check', { ticket: 'LS-TIX-TEST2ADULT22' })).data.code, 'practice_ticket', 'refused outside practice');
  assert.equal((await St.call('counts')).data.total, c0, 'not counted');
  assert.equal((await St.call('practice')).data.tickets.length, 7);
});

test('staff passes: VALID PASS with zones (not counted as fans), withdrawn = refused, fake = refused', async () => {
  const z = (await adm(null, '?view=passes')).data;
  assert.ok(z.zones.includes('Pitch side')); assert.ok(z.categories.guest);
  assert.equal((await adm({ action: 'pass_save', name: 'A', category: 'guest', zones: ['Pitch side'] })).status, 400);
  assert.equal((await adm({ action: 'pass_save', name: 'Seember Guest', category: 'guest', zones: [] })).status, 400);
  const p = (await adm({ action: 'pass_save', name: 'Seember Guest', organisation: 'Guest of player no. 9', category: 'guest', zones: ['Pitch side', 'VIP lounge', 'Nowhere'] })).data.pass;
  passes.push(p.id);
  assert.match(p.id, /^LS-ACC-[A-HJ-NP-Z2-9]{12}$/); assert.deepEqual(p.zones, ['Pitch side', 'VIP lounge']);
  const c0 = (await St.call('counts')).data.total;
  let r = (await St.call('check', { ticket: p.id })).data;
  assert.equal(r.code, 'pass_ok'); assert.equal(r.ticket.buyer, 'Seember Guest'); assert.deepEqual(r.ticket.zones, ['Pitch side', 'VIP lounge']);
  assert.equal((await St.call('check', { ticket: p.id })).data.code, 'pass_ok', 'a pass can be scanned again (in and out)');
  assert.equal((await St.call('counts')).data.total, c0, 'passes are not fans');
  const pack = (await St.call('offline')).data;
  assert.ok(pack.passes.some(x => x[0] === p.id && /Pitch side/.test(x[3])));
  assert.equal((await adm({ action: 'pass_revoke', id: p.id })).status, 200);
  r = (await St.call('check', { ticket: p.id })).data;
  assert.equal(r.code, 'pass_bad'); assert.equal(r.title, 'PASS WITHDRAWN');
  assert.equal((await St.call('check', { ticket: 'LS-ACC-ABCD2345EFGH' })).data.code, 'fake');
  // Out of date.
  const old = (await adm({ action: 'pass_save', name: 'Old Contractor', category: 'contractor', zones: ['All stands'], from: '2026-01-01', to: '2026-01-02' })).data.pass;
  passes.push(old.id);
  assert.equal((await St.call('check', { ticket: old.id })).data.title, 'PASS NOT VALID TODAY');
});

test('message to one scanner; readiness (camera, offline list, battery); queue speed', async () => {
  assert.equal((await adm({ action: 'message', to: `device:${St.id}`, text: `Go to VIP Gate ${T}` })).status, 200);
  assert.ok((await St.call('counts')).data.messages.some(m => m.personal && m.text.includes(T)), 'the scanner sees it');
  assert.ok(!(await Su.call('counts')).data.messages.some(m => m.text.includes(`Go to VIP Gate ${T}`)), 'nobody else does');
  const pack = (await St.call('offline')).data;
  const rep = battery => St.call('status', { camera: 'ok', wake: true, battery, pack: { n: pack.tickets.length, at: pack.at, match: pack.match?.id || '' } });
  assert.equal((await rep({ level: 0.15, charging: false })).status, 200);
  let row = (await adm()).data.devices.find(d => d.id === St.id);
  assert.equal(row.ready.ready, false); assert.equal(row.ready.battery, 15);
  assert.ok(row.ready.checks.some(c => c.key === 'battery' && !c.ok));
  await rep({ level: 0.8, charging: false });
  row = (await adm()).data.devices.find(d => d.id === St.id);
  assert.equal(row.ready.ready, true, JSON.stringify(row.ready.checks.filter(c => !c.ok)));
  const v = (await adm()).data;
  assert.ok(v.readyNow >= 1);
  assert.ok(v.queue.some(q => q.gate === St.s.gates[0] && q.perMinute > 0));
});

test('match-day report: preview and recipients', async () => {
  const r = await adm(null, '?view=report');
  assert.equal(r.status, 200); assert.match(r.text, /Matchday Test/); assert.match(r.text, /By stand/); assert.match(r.text, /Banned fan/);
  assert.equal((await adm({ action: 'report_settings', emails: 'not-an-email' })).status, 400);
  const s = await adm({ action: 'report_settings', emails: 'ops@example.com\nmanager@example.com', delay: 30 });
  assert.deepEqual(s.data.emails, ['ops@example.com', 'manager@example.com']);
  const v = (await adm()).data;
  assert.deepEqual(v.report.emails, ['ops@example.com', 'manager@example.com']); assert.equal(v.report.delay, 30);
});
