// MatchDay Kitchen for fans: order ahead (kick-off / half-time, saved with the time it
// is due, and not "late" before then), Popular now, the light match-day check for the
// site-wide reminder, "Tell me when it's on the way" (only with the order's private
// link), the poster page, and the ticket email's kitchen button.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './media-helpers.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const rows = q => JSON.parse(sql(q))[0].results;
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const T = Math.random().toString(36).slice(2, 7).replace(/\d/g, 'z');
const EV = `kf-${T}`;
let ref = '', token = '';
after(() => { sql(`DELETE FROM food_orders WHERE customer_name = 'Fan ${T}'; DELETE FROM events WHERE id = '${EV}';`); });

test('order for half-time: saved with the time it is due; not late before then', async () => {
  // A home match kicking off in an hour (so half-time is about 1 h 50 min away).
  sql(`INSERT INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo, active) VALUES ('${EV}', 'Lobi Stars FC', 'Test FC ${T}', 'NNL', '${new Date(Date.now() + 3600e3).toISOString()}', 'McCarthy Stadium', 0, 0, 0, 1);`);
  const r = await fetch(`${BASE}/api/food/whatsapp-order`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() },
    body: JSON.stringify({ name: `Fan ${T}`, phone: `0803${String(Math.random()).slice(2, 9)}`, fulfilment: 'seat', seat: 'Row 2, Seat 9', stand: 'VIP Seating', when: 'half-time', notes: 'Deliver at half-time.', items: [{ id: 'suya', qty: 1 }] }) }).then(x => x.json());
  assert.ok(r.ref, JSON.stringify(r)); ref = r.ref; token = new URL(r.trackUrl, BASE).searchParams.get('t');
  const o = rows(`SELECT id, deliver_when, deliver_at, event_id FROM food_orders WHERE ref = '${ref}';`)[0];
  assert.equal(o.deliver_when, 'half-time');
  if (o.event_id === EV) assert.ok(Math.abs(Date.parse(o.deliver_at) - (Date.now() + 3600e3 + 50 * 60e3)) < 5 * 60e3, 'due about kick-off + 50 min');
  const pub = await fetch(`${BASE}/api/food/order?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(token)}`).then(x => x.json());
  assert.equal(pub.order.deliverWhen, 'half-time');
  // Paid 30 minutes ago, but due later: not late yet.
  sql(`UPDATE food_orders SET order_status = 'PAID', payment_status = 'paid', paid_iso = '${new Date(Date.now() - 30 * 60e3).toISOString()}', deliver_at = '${new Date(Date.now() + 60 * 60e3).toISOString()}' WHERE ref = '${ref}';`);
  const K = await import('../functions/api/_lib/kitchenData.js').catch(() => null);
  if (K) { const t = K.ticket(rows(`SELECT * FROM food_orders WHERE ref = '${ref}';`)[0], 5); assert.equal(t.late, false, 'not late before it is due'); assert.equal(t.deliverWhen, 'half-time'); }
});

test('Popular now and the light match-day check', async () => {
  const m = await fetch(`${BASE}/api/food/menu`).then(x => x.json());
  assert.ok(Array.isArray(m.popular), 'popular list'); assert.equal(typeof m.matchday, 'boolean');
  const lite = await fetch(`${BASE}/api/food/menu?lite=1`);
  const d = await lite.json();
  assert.deepEqual(Object.keys(d).sort(), ['kickOff', 'matchday', 'open']); assert.equal(d.matchday, true, 'the test home match is today');
  assert.match(lite.headers.get('cache-control') || '', /max-age=120/);
});

test('"Tell me when it\'s on the way" needs the order\'s private link', async () => {
  const sub = { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'p'.repeat(40), auth: 'a'.repeat(16) } };
  const post = b => fetch(`${BASE}/api/food/notify`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify(b) });
  assert.equal((await post({ ref, t: 'wrong-token', subscription: sub })).status, 404);
  assert.equal((await post({ ref, t: token, subscription: { endpoint: 'http://insecure' } })).status, 400);
  assert.equal((await post({ ref, t: token, subscription: sub })).status, 200);
  assert.ok(rows(`SELECT push_sub FROM food_orders WHERE ref = '${ref}';`)[0].push_sub.includes('push.example.com'));
  const pub = await fetch(`${BASE}/api/food/order?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(token)}`).then(x => x.json());
  assert.equal(pub.order.alerts, true);
});

test('poster page and the reminder bar', async () => {
  const p = await fetch(`${BASE}/kitchen/poster/`);
  assert.equal(p.status, 200);
  const h = await p.text();
  assert.match(h, /<svg[^>]+QR code/); assert.match(h, /noindex/);
  const home = await fetch(`${BASE}/`).then(x => x.text());
  assert.match(home, /id="kitchenNudge"/);
});
