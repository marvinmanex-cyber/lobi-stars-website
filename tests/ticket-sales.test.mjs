// Ticket Sales dashboard (/api/admin/tickets/sales): paid online sales only (refunds and
// unpaid checkouts left out), the split by stand with percentages and money, one match or
// all, where buyers came from, and checkouts started vs paid. Plus the source labels.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './media-helpers.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const T = Math.random().toString(36).slice(2, 7).replace(/\d/g, 'q');
const EV = `ts-${T}`;
const get = q => fetch(`${BASE}/api/admin/tickets/sales${q || ''}`, { headers: ADMIN }).then(async r => ({ status: r.status, d: await r.json() }));
after(() => sql(`DELETE FROM orders WHERE event_id = '${EV}'; DELETE FROM events WHERE id = '${EV}';`));

test('sales by stand, money, sources; refunds and unpaid left out', async () => {
  await get(); // makes sure the new columns exist
  sql(`INSERT INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo, active) VALUES ('${EV}', 'Lobi Stars FC', 'Sales Test ${T}', 'NNL', '${new Date(Date.now() + 9 * 86400e3).toISOString()}', 'McCarthy Stadium', 150000, 80000, 40000, 1);
    INSERT INTO orders (id, event_id, buyer_name, buyer_email, buyer_phone, tier, quantity, unit_price_kobo, total_kobo, paystack_reference, payment_status, paid_at, basket_id, source, city, region, device) VALUES
    ('${T}-1', '${EV}', 'A One', 'a.${T}@example.com', '2348030000001', 'VIP', 1, 150000, 150000, 'r-${T}-1', 'paid', datetime('now'), 'b-${T}-1', 'Instagram', 'Makurdi', 'Benue', 'Phone'),
    ('${T}-2', '${EV}', 'B Two', 'b.${T}@example.com', '2348030000002', 'Premium', 2, 80000, 160000, 'r-${T}-2', 'paid', datetime('now'), 'b-${T}-2', 'WhatsApp', 'Makurdi', 'Benue', 'Phone'),
    ('${T}-3', '${EV}', 'C Three', 'c.${T}@example.com', '2348030000003', 'Regular', 1, 40000, 40000, 'r-${T}-3', 'paid', datetime('now'), 'b-${T}-3', 'Instagram', 'Abuja', 'FCT', 'Computer'),
    ('${T}-4', '${EV}', 'D Four', 'd.${T}@example.com', '2348030000004', 'Regular', 1, 40000, 40000, 'r-${T}-4', 'paid', datetime('now'), 'b-${T}-4', 'Google', 'Lagos', 'Lagos', 'Phone'),
    ('${T}-5', '${EV}', 'E Refunded', 'e.${T}@example.com', '2348030000005', 'VIP', 1, 150000, 150000, 'r-${T}-5', 'paid', datetime('now'), 'b-${T}-5', 'Instagram', '', '', 'Phone'),
    ('${T}-6', '${EV}', 'F Unpaid', 'f.${T}@example.com', '2348030000006', 'VIP', 3, 150000, 450000, 'r-${T}-6', 'pending', NULL, 'b-${T}-6', 'Facebook', '', '', 'Phone');
    UPDATE orders SET refunded_at = datetime('now') WHERE id = '${T}-5';`);
  const r = await get(`?event=${EV}`);
  assert.equal(r.status, 200, JSON.stringify(r.d));
  const d = r.d;
  assert.equal(d.totals.tickets, 5); assert.equal(d.totals.kobo, 390000); assert.equal(d.totals.buyers, 4);
  assert.equal(d.totals.checkouts, 6); assert.equal(d.totals.paidCheckouts, 5, 'checkouts paid (the refunded one was paid too)');
  const tier = Object.fromEntries(d.tiers.map(t => [t.tier, t]));
  assert.equal(tier.VIP.tickets, 1); assert.equal(tier.Premium.tickets, 2); assert.equal(tier.Regular.tickets, 2);
  assert.equal(tier.VIP.percent, 20); assert.equal(tier.Premium.percent, 40); assert.equal(tier.Regular.percent, 40);
  assert.equal(tier.Premium.label, 'Grand Stand'); assert.equal(tier.Regular.label, 'Popular Stand'); assert.equal(tier.Premium.kobo, 160000);
  assert.equal(d.sources.find(s => s.name === 'Instagram').tickets, 2); assert.ok(!d.sources.some(s => s.name === 'Facebook'), 'unpaid not counted');
  assert.ok(d.places.some(p => p.region === 'Benue' && p.city === 'Makurdi' && p.tickets === 3));
  assert.equal(d.recent.length, 4); assert.ok(!d.recent.some(x => x.buyer === 'E Refunded'));
  const m = d.matches.find(x => x.id === EV);
  assert.equal(m.kobo, 390000); assert.equal(m.tiers.find(t => t.tier === 'Premium').tickets, 2);
  // All matches: includes this one.
  const all = (await get()).d;
  assert.ok(all.totals.tickets >= 5); assert.ok(all.matches.some(x => x.id === EV && x.tickets === 5));
  assert.equal((await fetch(`${BASE}/api/admin/tickets/sales`)).status, 401, 'admins only');
});

test('source labels', async () => {
  const { sourceLabel, deviceOf } = await import('../functions/api/_lib/ticketSource.js');
  assert.equal(sourceLabel({ first: 'utm:instagram' }), 'Instagram');
  assert.equal(sourceLabel({ first: 'ref:l.facebook.com' }), 'Facebook');
  assert.equal(sourceLabel({ first: 'utm:ticket_email' }), 'Email');
  assert.equal(sourceLabel({ first: 'utm:poster' }), 'QR code / poster');
  assert.equal(sourceLabel({ first: 'ref:www.google.com' }), 'Google');
  assert.equal(sourceLabel({ first: 'ref:blog.example.org' }), 'Other website (blog.example.org)');
  assert.equal(sourceLabel({ via: '/' }), 'Website: Home page');
  assert.equal(sourceLabel({ via: '/fixtures/' }), 'Website: Fixtures page');
  assert.equal(sourceLabel({}), 'Direct (typed or bookmark)');
  assert.equal(deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile'), 'Phone');
  assert.equal(deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'Computer');
});
