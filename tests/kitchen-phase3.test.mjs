// Delivery zones and batching, tickets, ratings, reports, test alerts and safe retries, against a running server.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './media-helpers.mjs';
import { hashPassword } from '../functions/api/_lib/password.js';
import { zoneOf, runnerCovers, parseZones, recipientsFor, STAFF } from '../functions/api/_lib/kitchenWorkflow.js';
import { matchFigures, staffFigures, ratingFigures, csvRows } from '../functions/api/_lib/kitchenReports.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const T = Date.now().toString(36).toUpperCase();
const rows = q => JSON.parse(sql(q))[0].results;
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const SA_EMAIL = `p3-sa-${T.toLowerCase()}@example.com`, PW = 'Kitchen-Super-2026!';
const signIn = async body => { const r = await fetch(`${BASE}/api/matchday-kitchen/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify(body) }); return ((r.headers.get('set-cookie') || '').match(/ls_mdk=([^;]+)/) || [])[1]; };
async function as(cookie) {
  const s = await fetch(`${BASE}/api/matchday-kitchen/session`, { headers: { Cookie: `ls_mdk=${cookie}` } }).then(r => r.json());
  const headers = extra => ({ Cookie: `ls_mdk=${cookie}`, 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf, ...extra });
  const call = (path, body, extra = {}) => fetch(`${BASE}/api/matchday-kitchen/${path}`, body ? { method: 'POST', headers: headers(extra), body: JSON.stringify(body) } : { headers: headers(extra) }).then(async r => ({ status: r.status, headers: r.headers, text: await r.clone().text(), data: await r.json().catch(() => ({})) }));
  return { s, call };
}
const ids = [], staffIds = [];
const put = (status, { stand = 'Popular Stand', paid = true, extra = {} } = {}) => {
  const id = `P3${ids.length}${T}`; ids.push(id);
  const cols = Object.keys(extra), vals = cols.map(k => `'${extra[k]}'`);
  sql(`INSERT INTO food_orders (id, ref, seat, stand, phone, email, items_json, total_kobo, paystack_reference, payment_status, order_status, paid_iso, created_iso, channel, customer_name, view_token, venue_id${cols.map(c => `, ${c}`).join('')}) VALUES ('${id}', '${id}', 'A1', '${stand}', '+2348031234567', 'fan@example.com', '[{"id":"x","name":"Suya","qty":2,"priceKobo":100000,"note":"no pepper"}]', 200000, 'r-${id}', '${paid ? 'paid' : 'pending'}', '${status}', ${paid ? `'${new Date().toISOString()}'` : 'NULL'}, '${new Date().toISOString()}', 'paystack', 'Abigail Fan', 'tok${id}', 'venue-main'${vals.map(v => `, ${v}`).join('')});`);
  return id;
};
const status = id => rows(`SELECT order_status FROM food_orders WHERE id = '${id}'`)[0].order_status;
let A, S, C, R1, R2;
const staff = async (name, role, extra = {}) => { const a = await S.call('staff', { action: 'add', name: `P3 ${name} ${T}`, role }); staffIds.push(a.data.id); if (Object.keys(extra).length) await S.call('staff', { action: 'edit', id: a.data.id, ...extra }); return as(await signIn({ loginCode: a.data.loginCode })); };

test('zones and report sums, on their own', () => {
  const zones = parseZones('North: Popular Stand, Grand Stand\n\nnonsense line\nVIP: VIP Seating');
  assert.deepEqual(zones.map(z => z.id), ['north', 'vip']);
  assert.equal(zoneOf('grand stand', zones), 'north'); assert.equal(zoneOf('VIP Seating', zones), 'vip'); assert.equal(zoneOf('Elsewhere', zones), null); assert.equal(zoneOf('', zones), null);
  assert.ok(runnerCovers('north', 'north')); assert.ok(!runnerCovers('north', 'vip'));
  assert.ok(runnerCovers(null, 'vip'), 'a runner with no zone covers everything'); assert.ok(runnerCovers('north', null), 'an order outside every zone goes to everyone');
  const { RUN, SUP } = { RUN: STAFF.RUN, SUP: STAFF.SUP };
  const people = [{ endpoint: 'n', role: RUN, staffId: 'r1', zoneId: 'north' }, { endpoint: 'v', role: RUN, staffId: 'r2', zoneId: 'vip' }, { endpoint: 'all', role: RUN, staffId: 'r3' }, { endpoint: 's', role: SUP, staffId: 's1' }];
  const to = (ev, zone) => recipientsFor(ev, people, { orderZone: zone }).map(d => d.endpoint).sort();
  assert.deepEqual(to('ORDER_READY', 'north'), ['all', 'n', 's'], 'only that zone\'s runners, and those with no zone');
  assert.deepEqual(to('ESCALATION_READY', 'north'), ['all', 'n', 's', 'v'], 'overdue: every runner on duty');

  const o = { payment_status: 'paid', order_status: 'DELIVERED', total_kobo: 300000, items_json: '[{"name":"Suya","qty":2,"priceKobo":100000},{"name":"Water","qty":1,"priceKobo":100000}]', paid_iso: '2026-11-08T15:00:00Z', accepted_iso: '2026-11-08T15:02:00Z', preparing_at: '2026-11-08T15:03:00Z', ready_at: '2026-11-08T15:13:00Z', out_at: '2026-11-08T15:15:00Z', delivered_at: '2026-11-08T15:20:00Z' };
  const m = matchFigures([o, { ...o, order_status: 'REJECTED', reject_reason: 'sold_out' }, { ...o, order_status: 'CANCELLED', cancel_reason: 'Fan left' }]);
  assert.equal(m.orders, 1); assert.equal(m.revenueKobo, 300000);
  assert.deepEqual(m.stages, { confirm: 2, startCooking: 1, cook: 10, waitForRunner: 2, deliver: 5, total: 20 });
  assert.deepEqual(m.bestSellers[0], { name: 'Suya', qty: 2, sales: '₦2,000' });
  assert.deepEqual(m.stopped.map(s => s.reason).sort(), ['Cancelled: Fan left', 'Rejected: An item is sold out']);
  const ev = (st, id, role, at) => ({ order_id: 'o', kind: 'status', to_status: st, by_id: id, by_name: `${id} (X) – MatchDay Kitchen`, by_role: role, at });
  const sf = staffFigures([ev('PREPARING', 'c', 'cook', '2026-11-08T15:00:00Z'), ev('READY', 'c', 'cook', '2026-11-08T15:10:00Z'), ev('OUT_FOR_DELIVERY', 'r', 'delivery', '2026-11-08T15:11:00Z'), ev('DELIVERED', 'r', 'delivery', '2026-11-08T15:16:00Z')]);
  assert.equal(sf.find(p => p.role === 'cook').avgCookMinutes, 10); assert.equal(sf.find(p => p.role === 'delivery').avgDeliverMinutes, 5); assert.equal(sf[0].orders, 1);
  const rf = ratingFigures([{ food: 5, speed: 3, service: 4, match: 'A vs B', ref: 'x', comment: 'Nice' }, { food: 3, speed: 3, service: 2, match: 'A vs B', ref: 'y' }]);
  assert.equal(rf.count, 2); assert.equal(rf.food, 4); assert.equal(rf.byMatch[0].service, 3); assert.equal(rf.comments.length, 1);
  assert.ok(csvRows('match', { match: m }).length > 5); assert.equal(csvRows('staff', { staff: sf })[0][0], 'Name');
});

test('set up', async () => {
  await fetch(`${BASE}/api/food/menu`);
  sql(`UPDATE food_orders SET order_status = 'EXPIRED' WHERE order_status IN ('PAID','ACCEPTED','PREPARING','READY','OUT_FOR_DELIVERY'); INSERT INTO admin_users (id, name, email, password_hash, role, active, test_account) VALUES ('p3_${T}', 'P3 Admin', '${SA_EMAIL}', '${await hashPassword(PW)}', 'super_admin', 1, 1);`);
  A = await as(await signIn({ login: SA_EMAIL, password: PW }));
  const added = await A.call('staff', { action: 'add', name: `P3 Sup ${T}`, role: 'supervisor' }); staffIds.push(added.data.id);
  S = await as(await signIn({ loginCode: added.data.loginCode }));
  C = await staff('Cook', 'cook');
  assert.equal((await S.call('venue-settings', { zonesText: 'North: Popular Stand\nVIP: VIP Seating' })).status, 200);
  assert.deepEqual((await S.call('venue-settings')).data.settings.zones.map(z => z.id), ['north', 'vip']);
  R1 = await staff('North Runner', 'delivery', { zoneId: 'north' });
  R2 = await staff('Any Runner', 'delivery');
});

test('zones: a runner sees and hears their own zone; orders outside every zone reach everyone', async () => {
  const north = put('READY', { stand: 'Popular Stand' }), vip = put('READY', { stand: 'VIP Seating' }), other = put('READY', { stand: 'Somewhere Else' });
  const has = async (who, id) => ({ kitchen: (await who.call('kitchen')).data.tickets.some(t => t.id === id), pulse: (await who.call('pulse')).data.ready.some(x => x.id === id), delivery: (await who.call('delivery')).data.groups.some(g => g.ready.some(x => x.id === id)) });
  assert.deepEqual(await has(R1, north), { kitchen: true, pulse: true, delivery: true });
  assert.deepEqual(await has(R1, vip), { kitchen: false, pulse: false, delivery: false });
  assert.deepEqual(await has(R1, other), { kitchen: true, pulse: true, delivery: true });
  assert.deepEqual(await has(R2, vip), { kitchen: true, pulse: true, delivery: true }, 'no zone: everything');
  assert.equal((await R1.call('claim', { ids: [vip] })).status, 409, 'can\'t take another zone\'s order');
  assert.equal(status(vip), 'READY');
});

test('batching: a runner takes several orders in one area; one person wins each', async () => {
  const a = put('READY'), b = put('READY'), c = put('READY'), far = put('READY', { stand: 'VIP Seating' });
  assert.equal((await R2.call('claim', { ids: [a, far] })).status, 400, 'one area at a time');
  assert.equal((await C.call('claim', { ids: [a] })).status, 409, 'cooks don\'t deliver');
  assert.equal((await R2.call('claim', { ids: [] })).status, 400);
  sql(`UPDATE food_orders SET order_status = 'OUT_FOR_DELIVERY', claimed_by = 'someone', claimed_name = 'Someone' WHERE id = '${c}';`);
  const r = await R2.call('claim', { ids: [a, b, c] });
  assert.equal(r.status, 200, r.text); assert.deepEqual(r.data.claimed.sort(), [a, b].sort()); assert.deepEqual(r.data.missed, [c]);
  for (const id of [a, b]) { const row = rows(`SELECT order_status, claimed_by FROM food_orders WHERE id = '${id}'`)[0]; assert.equal(row.order_status, 'OUT_FOR_DELIVERY'); assert.equal(row.claimed_by, R2.s.user.id); }
  assert.ok(rows(`SELECT 1 FROM order_events WHERE order_id = '${a}' AND to_status = 'OUT_FOR_DELIVERY'`).length);
});

test('safe retries: the same tap twice acts once and gets the same answer', async () => {
  const id = put('PAID'), key = { 'X-Idempotency-Key': `key-${T}-1` };
  const first = await S.call('order', { id, to: 'ACCEPTED' }, key);
  assert.equal(first.status, 200);
  const again = await S.call('order', { id, to: 'ACCEPTED' }, key);
  assert.equal(again.status, 200, 'a lost answer: the retry still says it worked'); assert.equal(again.text, first.text); assert.equal(again.headers.get('x-idempotent-replay'), '1');
  assert.equal(rows(`SELECT COUNT(*) AS n FROM order_events WHERE order_id = '${id}' AND to_status = 'ACCEPTED'`)[0].n, 1, 'only once');
  assert.equal((await S.call('order', { id, to: 'ACCEPTED' })).status, 409, 'without a key: a real second attempt');
  // The key belongs to the person and the action.
  assert.equal((await A.call('order', { id, to: 'PREPARING' }, key)).status, 200, 'someone else\'s key is a new action');
  const bad = await C.call('order', { id: put('PAID'), to: 'ACCEPTED' }, { 'X-Idempotency-Key': `key-${T}-2` });
  assert.equal(bad.status, 403);
  assert.equal((await C.call('order', { id, to: 'READY' }, { 'X-Idempotency-Key': 'x' })).status, 200, 'a malformed key is simply ignored');
});

test('the kitchen ticket: what to cook and where, no money or phone number', async () => {
  const id = put('ACCEPTED', { extra: { notes: 'Extra <b>spicy</b>', deliver_when: 'half-time' } });
  const r = await C.call(`ticket?id=${id}`);
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /html/);
  assert.match(r.text, /2 × Suya/); assert.match(r.text, /no pepper/); assert.match(r.text, /Seat A1/); assert.match(r.text, /HALF-TIME/);
  assert.match(r.text, /Extra &lt;b&gt;spicy/, 'escaped');
  assert.doesNotMatch(r.text, /₦|2,000|8031234567|fan@example/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal((await C.call('ticket?id=nope')).status, 404);
  assert.equal((await fetch(`${BASE}/api/matchday-kitchen/ticket?id=${id}`)).status, 401);
});

test('ratings: only after delivery, only with the order\'s token, only once', async () => {
  const rate = (b, ipv = ip()) => fetch(`${BASE}/api/food/rating`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ipv }, body: JSON.stringify(b) });
  const body = (id, over = {}) => ({ ref: id, t: `tok${id}`, food: 5, speed: 4, service: 3, comment: 'Lovely <b>suya</b>', ...over });
  const early = put('PREPARING');
  assert.equal((await rate(body(early))).status, 409);
  const id = put('DELIVERED');
  const order = () => fetch(`${BASE}/api/food/order?ref=${id}&t=tok${id}`).then(r => r.json());
  assert.equal((await order()).canRate, true);
  assert.equal((await rate(body(id, { t: 'wrong' }))).status, 404);
  assert.equal((await rate(body(id, { food: 6 }))).status, 400);
  assert.equal((await rate(body(id, { speed: 0 }))).status, 400);
  assert.equal((await rate(body(id))).status, 200);
  assert.equal((await rate(body(id))).status, 409);
  assert.equal((await order()).canRate, false);
  const row = rows(`SELECT food, speed, service, comment FROM food_ratings WHERE order_id = '${id}'`)[0];
  assert.equal(row.food, 5); assert.equal(row.comment, 'Lovely suya', 'no markup kept');
  // In the report.
  const day = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
  const rep = (await S.call(`reports?day=${day}`)).data;
  assert.ok(rep.ratings.count >= 1); assert.ok(rep.ratings.comments.some(c => c.ref === id));
});

test('reports: supervisors and Super Admins, by venue, with CSV', async () => {
  const day = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
  const id = put('PREPARING');
  await C.call('order', { id, to: 'READY' });
  sql(`UPDATE food_orders SET preparing_at = '${new Date(Date.now() - 12 * 60000).toISOString()}' WHERE id = '${id}'; INSERT INTO order_events (order_id, to_status, by_id, by_name, by_role, at) VALUES ('${id}', 'PREPARING', 'x', 'x', 'cook', '${new Date(Date.now() - 12 * 60000).toISOString()}');`);
  const rejected = put('PAID');
  await S.call('order', { id: rejected, to: 'REJECTED', reason: 'sold_out' });
  for (const who of [C, R1]) assert.equal((await who.call(`reports?day=${day}`)).status, 403);
  const r = await S.call(`reports?day=${day}`);
  assert.equal(r.status, 200); assert.equal(r.data.day, day);
  assert.ok(r.data.match.orders > 0); assert.ok(r.data.match.bestSellers.some(b => b.name === 'Suya'));
  assert.ok(r.data.match.stopped.some(s => /sold out/.test(s.reason)));
  assert.ok(r.data.staff.some(p => /P3 Cook/.test(p.name)));
  assert.doesNotMatch(r.text, /8031234567|fan@example/, 'no customer details');
  const csv = await fetch(`${BASE}/api/matchday-kitchen/reports?day=${day}&kind=staff&format=csv`, { headers: { Cookie: (await S.call('session')).headers.get('x') || '' } });
  assert.equal(csv.status, 401, 'never without signing in');
  const signed = await S.call(`reports?day=${day}&kind=staff&format=csv`);
  assert.match(signed.headers.get('content-type'), /text\/csv/); assert.match(signed.headers.get('content-disposition'), /matchday-kitchen-staff/); assert.match(signed.text, /Orders handled/);
  // A name that looks like a spreadsheet formula can't run.
  assert.equal(((await S.call(`reports?day=${day}&kind=match&format=csv`)).text.match(/^=/m) || []).length, 0);
  // Another venue's figures stay out.
  const v = await A.call('venue', { name: `P3 Ground ${T}` });
  const far = put('PAID'); sql(`UPDATE food_orders SET venue_id = '${v.data.id}', total_kobo = 987654300 WHERE id = '${far}';`);
  assert.notEqual((await S.call(`reports?day=${day}`)).data.match.revenueKobo >= 987654300, true);
  assert.ok((await A.call(`reports?day=${day}`)).data.match.revenueKobo >= 987654300);
  sql(`DELETE FROM mk_venues WHERE id = '${v.data.id}';`);
});

test('test alerts: who it reached, and who has no device', async () => {
  assert.equal((await C.call('test-alerts', {})).status, 403);
  const endpoint = `https://127.0.0.1:1/p3-${T}`;
  assert.equal((await C.call('push', { action: 'on', subscription: { endpoint, keys: { p256dh: 'p', auth: 'a' } } })).status, 200);
  const r = await S.call('test-alerts', {});
  assert.equal(r.status, 200, r.text);
  const cook = r.data.people.find(p => /P3 Cook/.test(p.name)), run = r.data.people.find(p => /North Runner/.test(p.name));
  assert.equal(cook.devices, 1); assert.equal(cook.reached, 0, 'an unreachable device isn\'t counted as reached');
  assert.equal(run.devices, 0, 'no device set up');
  assert.ok(rows(`SELECT 1 FROM mk_activity WHERE action LIKE 'Sent a test alert%'`).length);
  sql(`DELETE FROM push_subs WHERE endpoint = '${endpoint}';`);
});

after(() => {
  const list = ids.map(i => `'${i}'`).join(',') || "''";
  sql(`DELETE FROM food_ratings WHERE order_id IN (${list}); DELETE FROM order_events WHERE order_id IN (${list}); DELETE FROM food_refunds WHERE order_id IN (${list}); DELETE FROM food_notification_log WHERE order_id IN (${list}); DELETE FROM food_orders WHERE id IN (${list}); DELETE FROM mk_staff WHERE full_name LIKE 'P3 %'; DELETE FROM admin_users WHERE email = '${SA_EMAIL}'; DELETE FROM mk_idempotency WHERE key LIKE '%key-${T}%'; UPDATE mk_venues SET settings_json = json_remove(settings_json, '$.zones') WHERE id = 'venue-main';`);
});
