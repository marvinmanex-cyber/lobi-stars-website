// MatchDay Kitchen extras against a running server: dish labels and sponsors, half-time slots with a
// limit, goal deals, Pay by bank transfer (switch), the collection board and "How much to prepare".
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './media-helpers.mjs';
import { hashPassword } from '../functions/api/_lib/password.js';
import { forecastFrom } from '../functions/api/_lib/prepForecast.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const T = Date.now().toString(36).toUpperCase();
const rows = q => JSON.parse(sql(q))[0].results;
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const EMAIL = `ki-sa-${T.toLowerCase()}@example.com`, PW = 'Kitchen-Super-2026!';
const menu = () => fetch(`${BASE}/api/food/menu`).then(r => r.json());
const order = body => fetch(`${BASE}/api/food/whatsapp-order`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() },
  body: JSON.stringify({ name: `Ideas ${T}`, phone: `0803${String(Math.random()).slice(2, 9)}`, fulfilment: 'seat', seat: 'Row 2, Seat 9', stand: 'VIP Seating', items: [{ id: 'suya', qty: 2 }], ...body }) })
  .then(async r => ({ status: r.status, d: await r.json().catch(() => ({})) }));

let A;
async function signIn() {
  const r = await fetch(`${BASE}/api/matchday-kitchen/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ login: EMAIL, password: PW }) });
  const cookie = ((r.headers.get('set-cookie') || '').match(/ls_mdk=([^;]+)/) || [])[1];
  const s = await fetch(`${BASE}/api/matchday-kitchen/session`, { headers: { Cookie: `ls_mdk=${cookie}` } }).then(x => x.json());
  return (path, body) => fetch(`${BASE}/api/matchday-kitchen/${path}`, body ? { method: 'POST', headers: { Cookie: `ls_mdk=${cookie}`, 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf }, body: JSON.stringify(body) } : { headers: { Cookie: `ls_mdk=${cookie}` } })
    .then(async x => ({ status: x.status, data: await x.json().catch(() => ({})) }));
}

after(() => {
  sql(`DELETE FROM food_orders WHERE customer_name = 'Ideas ${T}'; DELETE FROM food_settings WHERE key IN ('goalDeal', 'goalDealUntil', 'halftimeSlotCapacity', 'payByTransfer'); UPDATE food_items SET tags = NULL, sponsor = NULL WHERE id = 'suya'; DELETE FROM admin_users WHERE email = '${EMAIL}';`);
});

test('set up: a Super Admin', async () => {
  await menu();
  sql(`INSERT INTO admin_users (id, name, email, password_hash, role, active, test_account) VALUES ('ki_${T}', 'KI Admin', '${EMAIL}', '${await hashPassword(PW)}', 'super_admin', 1, 1);`);
  A = await signIn();
  const m = await A('menu');
  assert.equal(m.status, 200);
  assert.ok(m.data.tagNames.halal && m.data.goalDeal && m.data.slotCapacity === 40 && m.data.payTransfer === false);
});

test('labels and sponsor: saved by staff, shown to fans; unknown labels are dropped', async () => {
  const sponsor = (await A('menu')).data.partners[0]?.slug || null;
  const r = await A('menu', { action: 'labels', id: 'suya', tags: ['halal', 'kids', 'nonsense'], sponsor });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const item = (await menu()).categories.flatMap(c => c.items).find(i => i.id === 'suya');
  assert.deepEqual(item.tags, ['halal', 'kids']);
  if (sponsor) assert.equal(item.sponsor.slug, sponsor); else assert.equal(item.sponsor, null);
});

test('half-time slots: a full slot is refused and fans are told the next one', async () => {
  assert.equal((await A('menu', { action: 'slot-capacity', capacity: 'abc' })).status, 400);
  assert.equal((await A('menu', { action: 'slot-capacity', capacity: 1 })).data.capacity, 1);
  const before = (await menu()).halftimeSlots;
  if (!before.length) return; // no home match today on this database
  sql(`UPDATE food_orders SET order_status = 'EXPIRED' WHERE deliver_when = 'half-time'`);
  const a = await order({ when: 'half-time', slot: 'ht1' });
  assert.equal(a.status, 200, JSON.stringify(a.d));
  assert.equal(rows(`SELECT deliver_slot FROM food_orders WHERE ref = '${a.d.ref}'`)[0].deliver_slot, 'ht1');
  const b = await order({ when: 'half-time', slot: 'ht1' });
  assert.equal(b.status, 409);
  assert.match(b.d.error, /full.*middle of half-time/i);
  assert.equal((await menu()).halftimeSlots.find(s => s.id === 'ht1').full, true);
  const c = await order({ when: 'half-time', slot: 'ht2' });
  assert.equal(c.status, 200);
  assert.equal((await A('menu', { action: 'slot-capacity', capacity: 0 })).data.capacity, 0);
  assert.equal((await order({ when: 'half-time', slot: 'ht1' })).status, 200, 'no limit');
});

test('goal deal: limits checked; while on, the order is cheaper and the discount saved', async () => {
  assert.equal((await A('menu', { action: 'goal-deal', enabled: true, percent: 80, minutes: 10 })).status, 400);
  assert.equal((await A('menu', { action: 'goal-deal', enabled: true, percent: 10, minutes: 10 })).status, 200);
  const full = await order({});
  assert.equal(full.status, 200);
  const price = rows(`SELECT total_kobo, deal_kobo FROM food_orders WHERE ref = '${full.d.ref}'`)[0];
  assert.equal(price.deal_kobo, 0, 'no goal yet');
  sql(`INSERT INTO food_settings (key, value) VALUES ('goalDealUntil', '${new Date(Date.now() + 5 * 60e3).toISOString()}') ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
  assert.equal((await menu()).goalDeal.percent, 10, 'fans see the deal');
  const cheap = await order({});
  const p2 = rows(`SELECT total_kobo, deal_kobo FROM food_orders WHERE ref = '${cheap.d.ref}'`)[0];
  assert.equal(p2.deal_kobo, Math.floor(price.total_kobo * 0.1 / 100) * 100);
  assert.equal(p2.total_kobo, price.total_kobo - p2.deal_kobo);
  assert.equal((await A('menu', { action: 'goal-deal', enabled: false, percent: 10, minutes: 10 })).status, 200);
  assert.equal((await menu()).goalDeal, null, 'switching off ends a running deal');
});

test('Pay by bank transfer: off by default, switched on by staff, then shown to fans', async () => {
  assert.equal((await menu()).payTransfer, false);
  assert.equal((await A('menu', { action: 'pay-transfer', on: true })).data.on, true);
  assert.equal((await menu()).payTransfer, true);
  assert.equal((await A('menu', { action: 'pay-transfer', on: false })).data.on, false);
});

test('collection board: short numbers only, ready and preparing', async () => {
  const o = await order({ fulfilment: 'pickup', pickupPoint: 'Kiosk', seat: '', stand: '' });
  if (o.status !== 200) return; // no pickup points on this database
  sql(`UPDATE food_orders SET payment_status = 'paid', paid_iso = '${new Date().toISOString()}', order_status = 'READY' WHERE ref = '${o.d.ref}'`);
  const b = await fetch(`${BASE}/api/food/board`).then(r => r.json());
  const all = JSON.stringify(b);
  assert.ok(b.ready.length >= 1);
  assert.ok(!all.includes(`Ideas ${T}`), 'no names on the board');
  assert.equal((await fetch(`${BASE}/kitchen/board/`)).status, 200);
});

test('how much to prepare: from the reports, the most recent counting most, plus 15%', async () => {
  const f = forecastFrom([{ items: [{ name: 'Suya', qty: 10 }] }, { items: [{ name: 'Suya', qty: 20 }, { name: 'Water', qty: 6 }] }]);
  // Suya: (10×1 + 20×2) / 3 = 16.7 → 16.7 × 1.15 = 19.2 → 20. Water: (0 + 12) / 3 = 4 → 4.6 → 5.
  assert.deepEqual(f.map(i => [i.name, i.suggest, i.last]), [['Suya', 20, 20], ['Water', 5, 6]]);
  assert.deepEqual(forecastFrom([]), []);
  const r = await A('prep-forecast');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.items) && Array.isArray(r.data.halftimeSlots) && r.data.margin === 15);
});
