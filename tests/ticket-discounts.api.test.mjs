// Ticket discounts end to end (Paystack in TEST/fake mode, no real money):
// seeded OFF; admin switches rules on; badges; the price preview; checkout
// re-prices on the server (a stale total is refused before charging); a group
// of 20 split into rows of 10; the webhook refuses a wrong amount and a
// duplicate webhook issues nothing new; family bundle with CHILD at the gate;
// a match can exclude discounts; admin validation; the report.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123,
// PAYSTACK_SECRET_KEY=sk_test_local, PAYSTACK_FAKE=1, STAFF_SCAN_CODE=scan-test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 8);
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const call = (method, p, body, headers = ADMIN) => fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const pub = (p, body) => call('POST', p, body, { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() });
const H = 3600e3;
const buyer = () => ({ buyerName: `Discount Fan ${uid()}`, buyerEmail: `disc-${uid()}@example.com`, buyerPhone: '0803' + String(Math.random()).slice(2, 9) });
const webhook = (reference, amount) => {
  const body = JSON.stringify({ event: 'charge.success', data: { reference, amount, currency: 'NGN' } });
  const sig = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || 'sk_test_local').update(body).digest('hex');
  return fetch(`${BASE}/api/paystack-webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sig }, body }).then(r => r.status);
};
const rule = (id, patch) => call('PUT', '/api/admin/tickets/discounts', { rule: { id, ...patch } });

async function match(hoursAhead, settings = {}) {
  const r = await call('POST', '/api/admin/events', { home_team: 'Lobi Stars FC', away_team: `Discount Test ${uid()}`, competition: 'Friendly', venue: 'McCarthy Stadium, Makurdi',
    event_date: new Date(Date.now() + hoursAhead * H).toISOString(), vip_price_kobo: 500000, premium_price_kobo: 200000, regular_price_kobo: 100000, active: true, is_home: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await call('PUT', `/api/admin/tickets/match/${r.data.id}`, { isOnSale: true, maxPerOrder: 30, ...settings })).status, 200);
  return r.data.id;
}
const offersOf = async id => (await call('GET', '/api/tickets/catalogue', undefined, {})).data.matches.find(m => m.id === id)?.offers;

after(async () => { for (const id of ['group', 'early_bird', 'family']) await rule(id, { isActive: false }); });

test('seeded OFF with the suggested defaults; no badges while off', async () => {
  for (const id of ['group', 'early_bird', 'family']) await rule(id, { isActive: false });
  const d = (await call('GET', '/api/admin/tickets/discounts')).data;
  assert.deepEqual(d.rules.map(r => [r.id, r.isActive]), [['group', false], ['early_bird', false], ['family', false]]);
  assert.equal(d.settings.allowStacking, false); assert.equal(d.settings.maxTotalBp, 2500);
  const a = await match(30 * 24);
  assert.equal(await offersOf(a), null);
  const p = await pub('/api/tickets/price', { lines: [{ eventId: a, tier: 'Regular', quantity: 20 }] });
  assert.equal(p.data.discountKobo, 0); assert.equal(p.data.totalKobo, 2000000);
});

test('admin validation and the audit trail', async () => {
  assert.equal((await rule('group', { tiers: [{ minTickets: 20, percent: 15 }, { minTickets: 10, percent: 10 }] })).status, 400);
  assert.equal((await rule('early_bird', { percent: 120 })).status, 400);
  assert.equal((await rule('family', { config: { minAdults: 3, maxAdults: 2 } })).status, 400);
  assert.equal((await call('PUT', '/api/admin/tickets/discounts', { settings: { maxTotalPercent: 101 } })).status, 400);
  assert.equal((await call('GET', '/api/admin/tickets/discounts', undefined, { 'Content-Type': 'application/json' })).status, 401);
});

test('group of 20: badges, preview, stale total refused, rows of 10, webhook checks, no double tickets', async () => {
  assert.equal((await rule('group', { isActive: true, tiers: [{ minTickets: 10, percent: 10 }, { minTickets: 20, percent: 15 }] })).status, 200);
  assert.equal((await rule('early_bird', { isActive: true, percent: 10, config: { daysBefore: 7 } })).status, 200);
  const a = await match(30 * 24);
  const offers = await offersOf(a);
  assert.equal(offers.group.minTickets, 10); assert.equal(offers.group.maxPercentBp, 1500); assert.equal(offers.earlyBird.percentBp, 1000);

  const nine = (await pub('/api/tickets/price', { lines: [{ eventId: a, tier: 'Regular', quantity: 8 }] })).data;
  assert.equal(nine.label, 'Early bird (10%)', JSON.stringify(nine)); assert.equal(nine.matches[0].nudge, null, 'group 10% does not beat early bird 10%');
  const p = (await pub('/api/tickets/price', { lines: [{ eventId: a, tier: 'Regular', quantity: 20, unitKobo: 1, totalKobo: 1 }] })).data;
  assert.equal(p.label, 'Group (15%)'); assert.equal(p.discountKobo, 300000); assert.equal(p.totalKobo, 1700000, 'a price sent by the browser is ignored');
  assert.match(p.matches[0].reason, /not combined/);

  const b = buyer();
  const stale = await pub('/api/tickets/basket', { lines: [{ eventId: a, tier: 'Regular', quantity: 20 }], expectedTotalKobo: 2000000, ...b });
  assert.equal(stale.status, 409); assert.equal(stale.data.code, 'repriced'); assert.equal(stale.data.pricing.totalKobo, 1700000);
  const ok = await pub('/api/tickets/basket', { lines: [{ eventId: a, tier: 'Regular', quantity: 20 }], expectedTotalKobo: 1700000, groupName: 'St Mary Choir', ...b });
  assert.equal(ok.status, 200, JSON.stringify(ok.data)); assert.equal(ok.data.totalKobo, 1700000);
  const ref = ok.data.reference;

  assert.equal(await webhook(ref, 2000000), 400, 'full price refused: the locked total is 1,700,000');
  assert.equal(await webhook(ref, 1700000), 200);
  assert.equal(await webhook(ref, 1700000), 200, 'duplicate delivery');
  const done = (await call('GET', `/api/tickets/basket?reference=${ref}`, undefined, {})).data;
  assert.equal(done.paid, true);
  assert.equal(done.matches.length, 1, 'one match even though it is two rows of 10');
  assert.equal(done.matches[0].tickets.length, 20, 'no tickets issued twice');
  assert.equal(done.discountKobo, 300000); assert.equal(done.discountLabel, 'Group (15%)'); assert.equal(done.groupName, 'St Mary Choir');
  assert.equal(done.subtotalKobo, 2000000);

  // The same email can't get a second group discount for the same match by placing another order.
  const again = (await pub('/api/tickets/price', { lines: [{ eventId: a, tier: 'Regular', quantity: 10 }], buyerEmail: b.buyerEmail })).data;
  assert.equal(again.label, 'Early bird (10%)');

  const report = (await call('GET', '/api/admin/tickets/discounts')).data.report.find(r => r.ruleId === 'group');
  assert.ok(report.orders >= 1 && report.tickets >= 20 && report.discountKobo >= 300000);
});

test('a match can exclude discounts; a per-match cap limits discounted tickets', async () => {
  const off = await match(30 * 24, { allowDiscounts: false });
  assert.equal(await offersOf(off), null);
  assert.equal((await pub('/api/tickets/price', { lines: [{ eventId: off, tier: 'Regular', quantity: 20 }] })).data.discountKobo, 0);
  const capped = await match(30 * 24, { discountCap: 3 });
  const p = (await pub('/api/tickets/price', { lines: [{ eventId: capped, tier: 'Regular', quantity: 5 }] })).data;
  assert.equal(p.discountKobo, 3 * 10000, 'early bird on 3 of 5'); assert.match(p.matches[0].reason, /3 of 5/);
});

test('family bundle: adults + children, CHILD at the gate; invalid bundles refused', async () => {
  for (const id of ['group', 'early_bird']) await rule(id, { isActive: false });
  assert.equal((await rule('family', { isActive: true, percent: 15 })).status, 200);
  // Same Nigerian day as now (tickets only scan on match day), however late the test runs.
  const toMidnight = (86400e3 - ((Date.now() + 3600e3) % 86400e3)) / 3600e3;
  const a = await match(Math.max(0.02, Math.min(1, toMidnight - 0.02)));
  assert.match((await offersOf(a)).family.text, /1 or 2 adults with up to 4 children under 16/);
  const bad = await pub('/api/tickets/basket', { lines: [{ eventId: a, tier: 'Regular', family: true, adults: 3, children: 1 }], ...buyer() });
  assert.equal(bad.status, 400); assert.match(bad.data.error, /family bundle/i);
  const alone = await pub('/api/tickets/price', { lines: [{ eventId: a, tier: 'Regular', family: true, adults: 0, children: 2 }] });
  assert.equal(alone.data.ok, false);
  const r = await pub('/api/tickets/basket', { lines: [{ eventId: a, tier: 'Regular', family: true, adults: 2, children: 2 }], expectedTotalKobo: 340000, ...buyer() });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await webhook(r.data.reference, 340000), 200);
  const done = (await call('GET', `/api/tickets/basket?reference=${r.data.reference}`, undefined, {})).data;
  const kids = done.matches[0].tickets.filter(t => t.type === 'child');
  assert.equal(done.matches[0].tickets.length, 4); assert.equal(kids.length, 2);
  const g = await call('POST', '/api/validate-ticket', { ticketId: kids[0].id, staffCode: process.env.STAFF_SCAN_CODE || 'scan-test', station: 'test' }, { 'Content-Type': 'application/json' });
  assert.equal(g.data.valid, true, JSON.stringify(g.data)); assert.equal(g.data.ticketType, 'child');
  const adult = done.matches[0].tickets.find(t => t.type === 'adult');
  assert.equal((await call('POST', '/api/validate-ticket', { ticketId: adult.id, staffCode: process.env.STAFF_SCAN_CODE || 'scan-test', station: 'test' }, { 'Content-Type': 'application/json' })).data.ticketType, 'adult');
});
