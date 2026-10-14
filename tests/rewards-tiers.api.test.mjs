// Lobi Stars Rewards tiers: reaching Gold from points earned (celebration
// shown once), Gold's purchase multiplier, early ticket access for a signed-in
// Gold member (guests wait), Star Fans wall only for Star, admin tier
// settings. Uses small tier thresholds and switches Rewards live for the test,
// then puts the settings back.
// Needs the local Pages dev server (ADMIN_CODE=test-code-123, PAYSTACK_FAKE=1, FANS_DEV_LINKS=1).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 9);
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const call = (method, p, body, headers = ADMIN) => fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})), headers: r.headers }));
const pub = (p, body, cookie) => call('POST', p, body, { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip(), ...(cookie ? { Cookie: cookie } : {}) });
const phone = () => '0803' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const me = cookie => fetch(BASE + '/api/rewards/me', { headers: { Cookie: cookie } }).then(r => r.json());
const paid = (reference, amount) => { const raw = JSON.stringify({ event: 'charge.success', data: { reference, amount, currency: 'NGN' } }); return fetch(`${BASE}/api/paystack-webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || 'sk_test_local').update(raw).digest('hex') }, body: raw }).then(r => r.status); };
const lagos = ms => new Date(ms + 3600e3).toISOString().slice(0, 16);

let saved;
before(async () => {
  saved = (await call('GET', '/api/admin/rewards')).data.settings;
  const r = await call('PUT', '/api/admin/rewards', { settings: { live: true, tiers: [{ min: 0 }, { min: 60, multiplier: 1.25, presaleHours: 24 }, { min: 100000, multiplier: 1.5, presaleHours: 48 }] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});
after(async () => { await call('PUT', '/api/admin/rewards', { settings: saved }); });

async function member() {
  const email = `tier-${uid()}@example.com`;
  const reg = await pub('/api/fans/register', { firstName: 'Mnena', surname: 'Tyav', email, confirmEmail: email, phone: phone(), password: 'Lobi-Stars-2026', confirmPassword: 'Lobi-Stars-2026', agree: true, joinRewards: true, rewardsAgree: true });
  await fetch(reg.data.devLink.replace('https://lobistarsfc.com', BASE), { redirect: 'manual' });
  const login = await pub('/api/auth/login', { email, password: 'Lobi-Stars-2026' });
  return { cookie: login.headers.get('set-cookie').split(';')[0], email };
}
async function match(hoursAhead, settings = {}) {
  const r = await call('POST', '/api/admin/events', { home_team: 'Lobi Stars FC', away_team: `Tier Test ${uid()}`, competition: 'Friendly', venue: 'McCarthy Stadium, Makurdi',
    event_date: new Date(Date.now() + hoursAhead * 3600e3).toISOString(), vip_price_kobo: 500000, premium_price_kobo: 200000, regular_price_kobo: 100000, active: true, is_home: true });
  assert.equal((await call('PUT', `/api/admin/tickets/match/${r.data.id}`, { isOnSale: true, maxPerOrder: 10, ...settings })).status, 200);
  return r.data.id;
}
async function buy(m, eventId, quantity) {
  const r = await pub('/api/tickets/basket', { lines: [{ eventId, tier: 'Regular', quantity }], buyerName: 'Mnena Tyav', buyerEmail: m.email, buyerPhone: phone() }, m.cookie);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await paid(r.data.reference, r.data.totalKobo), 200);
}

test('reaching Gold: from points earned this season; celebration once; Gold multiplier on the next purchase', async () => {
  const m = await member();
  let d = await me(m.cookie);
  assert.equal(d.tier.key, 'red'); assert.equal(d.tier.toNext, 10, '50 welcome points, Gold at 60');
  const ev = await match(48);
  await buy(m, ev, 2); // 20 points, pending
  assert.equal((await call('PUT', `/api/admin/match-centre/${ev}`, { status: 'full-time', home_score: 1, away_score: 0 })).status, 200);
  d = await me(m.cookie);
  assert.equal(d.tier.key, 'gold'); assert.equal(d.tier.earned, 120, 'welcome 50 + first-purchase 50 + tickets 20'); assert.equal(d.tier.celebrate, true);
  assert.ok(d.tier.benefits.includes('1.25x Pride Points on purchases'));
  assert.equal((await pub('/api/rewards/tier', { action: 'seen' }, m.cookie)).status, 200);
  assert.equal((await me(m.cookie)).tier.celebrate, false, 'shown once');
  await buy(m, await match(49), 4); // ₦4,000 -> 40 x 1.25 = 50
  assert.equal((await me(m.cookie)).pending, 50);
  assert.equal((await pub('/api/rewards/tier', { action: 'star-wall', optIn: true }, m.cookie)).status, 403, 'Star Fans wall is for Star members');
  const look = (await call('GET', `/api/admin/rewards/member?q=${encodeURIComponent(m.email)}`)).data;
  assert.equal(look.tier.name, 'Gold');
});

test('early ticket access: a signed-in Gold member can buy before sales open; guests cannot', async () => {
  const m = await member();
  const ev0 = await match(47); await buy(m, ev0, 2);
  await call('PUT', `/api/admin/match-centre/${ev0}`, { status: 'full-time', home_score: 0, away_score: 0 });
  assert.equal((await me(m.cookie)).tier.key, 'gold');
  const ev = await match(72, { saleOpensAt: lagos(Date.now() + 10 * 3600e3) }); // opens in 10 hours; Gold gets 24 hours early
  const guest = (await call('GET', '/api/tickets/catalogue', undefined, {})).data.matches.find(x => x.id === ev);
  assert.equal(guest.state, 'not_on_sale');
  const mine = (await call('GET', '/api/tickets/catalogue', undefined, { Cookie: m.cookie })).data.matches.find(x => x.id === ev);
  assert.equal(mine.state, 'on_sale'); assert.equal(mine.presale, true);
  const g = await pub('/api/tickets/basket', { lines: [{ eventId: ev, tier: 'Regular', quantity: 1 }], buyerName: 'Guest Fan', buyerEmail: `g-${uid()}@example.com`, buyerPhone: phone() });
  assert.equal(g.status, 400); assert.match(g.data.error, /not on sale/);
  await buy(m, ev, 1);
});

test('admin: tier settings are validated', async () => {
  assert.equal((await call('PUT', '/api/admin/rewards', { settings: { tiers: [{ min: 0 }, { min: 500 }, { min: 400 }] } })).status, 400);
  assert.equal((await call('PUT', '/api/admin/rewards', { settings: { tierGraceMonths: 13 } })).status, 400);
  const s = (await call('GET', '/api/admin/rewards')).data;
  assert.ok(s.stats.tiers, 'tier counts');
});
