// MatchDay Kitchen (/kitchen/): the page, the menu fields it uses, Pay Online
// returning to /kitchen/, and prices always coming from the server (a price
// sent by the browser is ignored). Needs the local Pages dev server with
// PAYSTACK_FAKE=1 (no real money) and ordering open in Admin › Food.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const post = (p, body) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.9.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}` }, body: JSON.stringify(body) })
  .then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));

test('the page: title, logo, share image, seat bar, both ways to pay', async () => {
  const html = await (await fetch(`${BASE}/kitchen/`)).text();
  assert.match(html, /<title>MatchDay Kitchen \| Lobi Stars FC<\/title>/);
  assert.match(html, /matchday-kitchen-logo/);
  assert.match(html, /og-kitchen\.jpg/);
  assert.match(html, /id="kxSection"/); assert.match(html, /id="kxRow"/); assert.match(html, /id="kxSeat"/);
  assert.match(html, /Pay online/); assert.match(html, /Order via WhatsApp/);
  const home = await (await fetch(`${BASE}/`)).text();
  assert.match(home, /class="sh-link sh-pill[^"]*" href="\/kitchen\/"/, 'green MatchDay Kitchen pill in the menu');
});

test('menu fields for the page: spice, badge, open/close times', async () => {
  const d = await (await fetch(`${BASE}/api/food/menu`)).json();
  assert.ok('opensAt' in d && 'closesAt' in d);
  const item = d.categories.flatMap(c => c.items)[0];
  assert.ok(item && 'spice' in item && 'badge' in item, JSON.stringify(item));
});

test('Pay Online comes back to /kitchen/, and the price is worked out on the server', async t => {
  const d = await (await fetch(`${BASE}/api/food/menu`)).json();
  if (!d.open) return t.skip('ordering is closed on this server');
  const item = d.categories.flatMap(c => c.items).find(i => !i.soldOut && !i.adult);
  const r = await post('/api/food-checkout', {
    name: 'Kitchen Test', phone: '08031234567', email: 'kitchen-test@example.com', stand: d.stands[0] || 'Cover Stand', seat: 'Row 1, Seat 2',
    notes: 'Deliver at half-time.', fulfilment: 'seat', returnTo: 'kitchen',
    items: [{ id: item.id, qty: 2, priceKobo: 1 }], totalKobo: 2, // a tampered price from the browser
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.authorizationUrl, /\/kitchen\/\?ref=FD-\d{8}-\d{4}&t=/);
  const t2 = new URL(r.data.authorizationUrl).searchParams.get('t');
  const o = await (await fetch(`${BASE}/api/food/order?ref=${r.data.ref}&t=${t2}`)).json();
  assert.equal(o.order.totalKobo, item.priceKobo * 2, 'server price, not the browser one');
  assert.equal(o.order.notes, 'Deliver at half-time.');
});
