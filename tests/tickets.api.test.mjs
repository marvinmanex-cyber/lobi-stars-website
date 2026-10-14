// Match tickets end to end (Paystack in TEST/fake mode, no real money):
// off by default, away matches never on sale, capacity and oversell
// protection under two simultaneous buyers, one payment for several matches,
// duplicate webhooks, lookup (and its rate limit), refunds, gate states.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123,
// PAYSTACK_SECRET_KEY=sk_test_local, PAYSTACK_FAKE=1, STAFF_SCAN_CODE=scan-test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 8);
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const call = (method, p, body, headers = ADMIN) => fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const pub = (p, body, extra = {}) => call('POST', p, body, { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip(), ...extra });
const H = 3600e3;

async function match(hoursAhead, home = true) {
  const r = await call('POST', '/api/admin/events', { home_team: home ? 'Lobi Stars FC' : 'Kano Pillars', away_team: home ? `Ticket Test ${uid()}` : 'Lobi Stars FC', competition: 'Friendly', venue: 'McCarthy Stadium, Makurdi',
    event_date: new Date(Date.now() + hoursAhead * H).toISOString(), vip_price_kobo: 500000, premium_price_kobo: 200000, regular_price_kobo: 100000, active: true, is_home: home });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.id;
}
const buyer = () => ({ buyerName: `Ticket Fan ${uid()}`, buyerEmail: `tix-${uid()}@example.com`, buyerPhone: '0803' + String(Math.random()).slice(2, 9) });
const pay = async (reference, amount) => {
  await pub('/api/dev/paystack-fake', { reference, status: 'success', amount });
  return call('GET', `/api/tickets/basket?reference=${reference}`, undefined, {});
};
const webhook = (reference, amount) => {
  const body = JSON.stringify({ event: 'charge.success', data: { reference, amount, currency: 'NGN' } });
  const sig = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || 'sk_test_local').update(body).digest('hex');
  return fetch(`${BASE}/api/paystack-webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sig }, body }).then(r => r.status);
};
const gate = id => call('POST', '/api/validate-ticket', { ticketId: id, staffCode: process.env.STAFF_SCAN_CODE || 'scan-test', station: 'test' }, { 'Content-Type': 'application/json' });

test('off by default; away matches can never be put on sale; the old checkout follows the same rules', async () => {
  const a = await match(48);
  const cat = (await call('GET', '/api/tickets/catalogue', undefined, {})).data.matches;
  assert.equal(cat.find(m => m.id === a).state, 'not_on_sale');
  const r = await pub('/api/tickets/basket', { lines: [{ eventId: a, tier: 'VIP', quantity: 1 }], ...buyer() });
  assert.equal(r.status, 400); assert.match(r.data.error, /not on sale/);
  assert.equal((await pub('/api/checkout', { eventId: a, tier: 'VIP', quantity: 1, ...buyer() })).status, 400, 'single checkout refused too');
  const away = await match(72, false);
  const off = await call('PUT', `/api/admin/tickets/match/${away}`, { isOnSale: true });
  assert.equal(off.status, 400); assert.match(off.data.error, /home matches/);
  assert.ok(!(await call('GET', '/api/tickets/catalogue', undefined, {})).data.matches.some(m => m.id === away), 'away matches are not listed');
  // Admin checks
  assert.equal((await call('PUT', `/api/admin/tickets/match/${a}`, { maxPerOrder: 50 })).status, 400);
  assert.equal((await call('PUT', `/api/admin/tickets/match/${a}`, { saleOpensAt: '2026-12-02T10:00', saleClosesAt: '2026-12-01T10:00' })).status, 400);
  assert.equal((await call('GET', '/api/admin/tickets', undefined, { 'Content-Type': 'application/json' })).status, 401);
});

test('capacity: two buyers at once for the last seats, only one gets them; then sold out', async () => {
  const a = await match(50);
  assert.equal((await call('PUT', `/api/admin/tickets/match/${a}`, { isOnSale: true, capacities: { Regular: 2 }, maxPerOrder: 4 })).status, 200);
  const cat = (await call('GET', '/api/tickets/catalogue', undefined, {})).data.matches.find(m => m.id === a);
  assert.equal(cat.state, 'on_sale');
  assert.equal(cat.tiers.find(t => t.tier === 'Regular').left, 2);
  const [x, y] = await Promise.all([1, 2].map(() => pub('/api/tickets/basket', { lines: [{ eventId: a, tier: 'Regular', quantity: 2 }], ...buyer() })));
  const statuses = [x.status, y.status].sort();
  assert.deepEqual(statuses, [200, 409], JSON.stringify([x.data, y.data]));
  const lost = x.status === 409 ? x : y;
  assert.equal(lost.data.soldOut, true); assert.equal(lost.data.eventId, a); assert.match(lost.data.error, /sold out/);
  const left = (await call('GET', '/api/tickets/catalogue', undefined, {})).data.matches.find(m => m.id === a).tiers.find(t => t.tier === 'Regular').left;
  assert.equal(left, 0, 'seats held by the unpaid order');
  // VIP (no capacity set) is still on sale.
  assert.equal((await call('GET', '/api/tickets/catalogue', undefined, {})).data.matches.find(m => m.id === a).state, 'on_sale');
});

test('one payment for several matches: tickets per match, duplicate webhook issues nothing new, lookup, refund, gate states', async () => {
  // "Today's" match: later today in Nigeria (WAT = UTC+1), never past midnight.
  const endOfLagosDay = (() => { const d = new Date(Date.now() + H); d.setUTCHours(23, 0, 0, 0); return d.getTime() - H; })();
  const hoursToday = Math.max(5 / 60, Math.min(2, (endOfLagosDay - Date.now()) / H - 5 / 60));
  const today = await match(hoursToday), later = await match(24 * 7);
  for (const id of [today, later]) assert.equal((await call('PUT', `/api/admin/tickets/match/${id}`, { isOnSale: true })).status, 200);
  const b = buyer();
  const r = await pub('/api/tickets/basket', { lines: [{ eventId: today, tier: 'VIP', quantity: 2 }, { eventId: later, tier: 'Regular', quantity: 1 }], ...b });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const ref = r.data.reference, total = 2 * 500000 + 100000;
  assert.equal((await call('GET', `/api/tickets/basket?reference=${ref}`, undefined, {})).data.paid, false);
  assert.equal(await webhook(ref, 100), 400, 'wrong amount refused');
  const paid = await pay(ref, total);
  assert.equal(paid.data.paid, true, JSON.stringify(paid.data));
  assert.equal(paid.data.matches.length, 2);
  assert.deepEqual(paid.data.matches.map(m => m.tickets.length).sort(), [1, 2]);
  const ids = paid.data.matches.flatMap(m => m.tickets.map(t => t.id));
  assert.ok(ids.every(id => /^LS-TIX-[A-Z0-9]{12}$/.test(id)));
  // The webhook arrives (twice): nothing is issued again.
  assert.equal(await webhook(ref, total), 200);
  assert.equal(await webhook(ref, total), 200);
  const again = await call('GET', `/api/tickets/basket?reference=${ref}`, undefined, {});
  assert.deepEqual(again.data.matches.flatMap(m => m.tickets.map(t => t.id)).sort(), [...ids].sort());
  // Lookup with the email and reference; wrong email refused.
  const lip = ip();
  assert.equal((await pub('/api/tickets/lookup', { email: 'someone@else.com', reference: ref }, { 'CF-Connecting-IP': lip })).status, 404);
  const look = await pub('/api/tickets/lookup', { email: b.buyerEmail.toUpperCase(), reference: ref.toLowerCase() }, { 'CF-Connecting-IP': lip });
  assert.equal(look.status, 200); assert.equal(look.data.matches.length, 2);
  assert.ok(!JSON.stringify(look.data).includes(b.buyerPhone), 'no phone number in the lookup');
  // Gate: valid, then already used (with the time); the later match's ticket is the wrong match today.
  const todayTicket = paid.data.matches.find(m => m.eventId === today).tickets[0].id;
  const laterTicket = paid.data.matches.find(m => m.eventId === later).tickets[0].id;
  const g1 = await gate(todayTicket);
  assert.equal(g1.data.code, 'valid');
  const g2 = await gate(todayTicket);
  assert.equal(g2.data.code, 'used'); assert.match(g2.data.reason, /^Already used: scanned (?!.*\bWAT\b).+$/);
  assert.equal((await gate(laterTicket)).data.code, 'wrong_match');
  // Admin: the order is listed; refunding cancels the unused tickets.
  const list = (await call('GET', `/api/admin/tickets/orders?q=${encodeURIComponent(ref.toLowerCase())}`)).data.orders;
  assert.equal(list.length, 1); assert.equal(list[0].kind, 'basket'); assert.equal(list[0].tickets, 3);
  assert.equal((await call('POST', `/api/admin/tickets/orders/${list[0].id}/refund`, { reason: '' })).status, 400);
  assert.equal((await call('POST', `/api/admin/tickets/orders/${list[0].id}/refund`, { reason: 'Test refund' })).status, 200);
  assert.equal((await gate(laterTicket)).data.code, 'void');
  const sales = (await call('GET', '/api/admin/tickets')).data.matches.find(m => m.id === later);
  assert.equal(sales.tiers.find(t => t.tier === 'Regular').sold, 0, 'refunded sales are not counted');
});

test('lookup is rate-limited', async () => {
  const lip = ip();
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await pub('/api/tickets/lookup', { email: 'nobody@example.com', reference: 'LSBAS-NOTREAL0000' }, { 'CF-Connecting-IP': lip })).status);
  assert.deepEqual(codes, [404, 404, 404, 404, 404, 429]);
});

test('public pages: /tickets lists home matches, homepage shows Upcoming Matches with Buy ticket', async () => {
  const tickets = await (await fetch(`${BASE}/tickets/`)).text();
  assert.match(tickets, /Select all home matches/);
  assert.match(tickets, /Select next 3 matches/);
  const home = await (await fetch(`${BASE}/`)).text();
  assert.match(home, /Upcoming Matches/);
  assert.match(home, /fx-card--featured/);
  assert.ok((home.match(/<li class="fx-card/g) || []).length <= 3);
});
