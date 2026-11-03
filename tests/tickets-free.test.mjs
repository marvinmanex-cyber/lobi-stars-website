// Free stands: a stand set to "Free" is booked online like a paid ticket (name, email,
// phone) but nothing goes to Paystack: the tickets are issued at once (PDF, email) and
// shown on the success page. Free stands stay open while online payment is paused
// (paid stands then show "Opening soon"); "Opening soon" stands can't be booked; a fair
// share per person per match; discounts never apply.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './media-helpers.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const T = Math.random().toString(36).slice(2, 7).replace(/\d/g, 'q');
const EV = `free-${T}`;
const admin = (path, method, body) => fetch(`${BASE}/api/admin/tickets${path}`, { method, headers: ADMIN, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, d: await r.json().catch(() => ({})) }));
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const book = (lines, who = {}) => fetch(`${BASE}/api/tickets/basket`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() },
  body: JSON.stringify({ lines, buyerName: 'Free Fan', buyerEmail: `fan.${T}@example.com`, buyerPhone: '08031234567', ...who }) }).then(async r => ({ status: r.status, d: await r.json().catch(() => ({})) }));
const cat = () => fetch(`${BASE}/api/tickets/catalogue`).then(r => r.json());

after(async () => {
  await admin('', 'POST', { action: 'pause', paused: false, message: '' });
  sql(`DELETE FROM tickets WHERE event_id = '${EV}'; DELETE FROM orders WHERE event_id = '${EV}'; DELETE FROM league_ticket_settings WHERE event_id = '${EV}'; DELETE FROM events WHERE id = '${EV}';`);
});

test('a Free stand: no payment, tickets issued and shown; paid stands "Opening soon" while paused; fair share per person', async () => {
  await cat(); // makes sure the new columns exist
  sql(`INSERT INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo, active) VALUES ('${EV}', 'Lobi Stars FC', 'Free Test ${T}', 'NNL', '${new Date(Date.now() + 6 * 86400e3).toISOString()}', 'McCarthy Stadium', 150000, 80000, 40000, 1);`);
  // Admin: Popular Stand free, the rest paid; most per order 3.
  assert.equal((await admin(`/match/${EV}`, 'PUT', { isOnSale: true, maxPerOrder: 3, modes: { Regular: 'nope' } })).status, 400);
  const put = await admin(`/match/${EV}`, 'PUT', { isOnSale: true, maxPerOrder: 3, modes: { VIP: 'paid', Premium: 'paid', Regular: 'free' } });
  assert.equal(put.status, 200, JSON.stringify(put.d));
  const view = (await admin('', 'GET')).d.matches.find(m => m.id === EV);
  assert.equal(view.tiers.find(t => t.tier === 'Regular').mode, 'free');

  // Online payment paused: the free stand stays open, paid stands show "Opening soon".
  assert.equal((await admin('', 'POST', { action: 'pause', paused: true, message: 'Online tickets open soon. Paid test.' })).status, 200);
  let c = await cat();
  let m = c.matches.find(x => x.id === EV);
  assert.equal(m.state, 'on_sale'); assert.equal(c.pause.freeOpen, true);
  const reg = m.tiers.find(t => t.tier === 'Regular'), vip = m.tiers.find(t => t.tier === 'VIP');
  assert.equal(reg.free, true); assert.equal(reg.priceKobo, 0); assert.equal(vip.soon, true);
  const paidTry = await book([{ eventId: EV, tier: 'VIP', quantity: 1 }]);
  assert.equal(paidTry.status, 409); assert.match(paidTry.d.error, /Paid test/);

  // The quote and the booking: nothing to pay.
  const q = await fetch(`${BASE}/api/tickets/price`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines: [{ eventId: EV, tier: 'Regular', quantity: 2 }] }) }).then(r => r.json());
  assert.equal(q.ok, true); assert.equal(q.totalKobo, 0);
  const b1 = await book([{ eventId: EV, tier: 'Regular', quantity: 2 }]);
  assert.equal(b1.status, 200, JSON.stringify(b1.d)); assert.equal(b1.d.free, true); assert.ok(!b1.d.authorizationUrl);
  assert.match(b1.d.redirect, /\/tickets\/success\/\?basket=LSBAS-.*&free=1/);
  const got = await fetch(`${BASE}/api/tickets/basket?reference=${b1.d.reference}`).then(r => r.json());
  assert.equal(got.paid, true); assert.equal(got.totalKobo, 0);
  assert.equal(got.matches[0].tickets.length, 2); assert.equal(got.matches[0].tickets[0].priceKobo, 0);
  const rows = JSON.parse(sql(`SELECT t.status, o.payment_status, o.unit_price_kobo FROM tickets t JOIN orders o ON o.id = t.order_id WHERE t.event_id = '${EV}'`))[0].results;
  assert.equal(rows.length, 2); assert.ok(rows.every(r => r.status === 'valid' && r.payment_status === 'paid' && r.unit_price_kobo === 0));
  const pdf = await fetch(`${BASE}/api/tickets/pdf?reference=${b1.d.reference}`);
  assert.equal(pdf.status, 200); assert.match(pdf.headers.get('content-type') || '', /pdf/);

  // A fair share: at most 3 free tickets per person (email or phone) for this match.
  const b2 = await book([{ eventId: EV, tier: 'Regular', quantity: 2 }]);
  assert.equal(b2.status, 400); assert.match(b2.d.error, /limited to 3 per person.*book 1 more/);
  // Another email but the same phone: counts as the same person (2 + 1 = 3 allowed, then no more).
  assert.equal((await book([{ eventId: EV, tier: 'Regular', quantity: 1 }], { buyerEmail: `other.${T}@example.com` })).status, 200);
  assert.match((await book([{ eventId: EV, tier: 'Regular', quantity: 1 }], { buyerEmail: `third.${T}@example.com` })).d.error, /already have the most free tickets/);
  assert.match((await book([{ eventId: EV, tier: 'Regular', quantity: 1 }])).d.error, /already have the most free tickets/);

  // Resumed: paid stands open with their prices; "Opening soon" can be set for a stand.
  await admin('', 'POST', { action: 'pause', paused: false, message: '' });
  m = (await cat()).matches.find(x => x.id === EV);
  assert.equal(m.tiers.find(t => t.tier === 'VIP').soon, false); assert.equal(m.tiers.find(t => t.tier === 'VIP').priceKobo, 150000);
  await admin(`/match/${EV}`, 'PUT', { modes: { Premium: 'soon' } });
  m = (await cat()).matches.find(x => x.id === EV);
  assert.equal(m.tiers.find(t => t.tier === 'Premium').soon, true);
  const soon = await book([{ eventId: EV, tier: 'Premium', quantity: 1 }], { buyerEmail: `third.${T}@example.com`, buyerPhone: '08039876543' });
  assert.equal(soon.status, 400); assert.match(soon.d.error, /opening soon/);
  // The old single-ticket checkout never sends a free stand to Paystack.
  const single = await fetch(`${BASE}/api/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: EV, tier: 'Regular', quantity: 1, buyerName: 'A B', buyerEmail: `x.${T}@example.com`, buyerPhone: '08031112222' }) });
  assert.equal(single.status, 400);
  // The homepage / fixtures say "Get free ticket" when the cheapest open stand is free.
  const list = await fetch(`${BASE}/api/matches`).then(r => r.json());
  const mm = (list.matches || []).find(x => x.id === EV);
  if (mm) { assert.equal(mm.ticket.fromKobo, 0); assert.equal(mm.ticket.free, true); }
});
