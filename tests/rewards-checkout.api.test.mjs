// Lobi Stars Rewards at checkout: "Use my Star Points" on match tickets.
// Points are held when payment starts, taken when Paystack confirms, refused
// above the limit, given back on a refund; no points are earned on the part
// paid with points. Switches Rewards live for the test, then puts settings back.
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
const webhook = (reference, amount, event = 'charge.success') => { const raw = JSON.stringify({ event, data: { reference, amount, currency: 'NGN', transaction: { reference } } }); return fetch(`${BASE}/api/paystack-webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || 'sk_test_local').update(raw).digest('hex') }, body: raw }).then(r => r.status); };

let saved;
before(async () => { saved = (await call('GET', '/api/admin/rewards')).data.settings; await call('PUT', '/api/admin/rewards', { settings: { live: true } }); });
after(async () => { await call('PUT', '/api/admin/rewards', { settings: saved }); });

async function member(points) {
  const email = `co-${uid()}@example.com`;
  const reg = await pub('/api/fans/register', { firstName: 'Doosuur', surname: 'Ityav', email, confirmEmail: email, phone: phone(), password: 'Lobi-Stars-2026', confirmPassword: 'Lobi-Stars-2026', agree: true, joinRewards: true, rewardsAgree: true });
  await fetch(reg.data.devLink.replace('https://lobistarsfc.com', BASE), { redirect: 'manual' });
  const cookie = (await pub('/api/auth/login', { email, password: 'Lobi-Stars-2026' })).headers.get('set-cookie').split(';')[0];
  const look = (await call('GET', `/api/admin/rewards/member?q=${encodeURIComponent(email)}`)).data;
  await call('POST', '/api/admin/rewards/member', { memberId: look.member.id, action: 'adjust', points: points - 50, reason: 'Test points' });
  return { cookie, email };
}
async function match() {
  const r = await call('POST', '/api/admin/events', { home_team: 'Lobi Stars FC', away_team: `Points Pay ${uid()}`, competition: 'Friendly', venue: 'McCarthy Stadium, Makurdi', event_date: new Date(Date.now() + 80 * 3600e3).toISOString(), vip_price_kobo: 500000, premium_price_kobo: 200000, regular_price_kobo: 100000, active: true, is_home: true });
  await call('PUT', `/api/admin/tickets/match/${r.data.id}`, { isOnSale: true });
  return r.data.id;
}
const basket = (m, ev, usePoints) => pub('/api/tickets/basket', { lines: [{ eventId: ev, tier: 'VIP', quantity: 1 }], usePoints, buyerName: 'Doosuur Ityav', buyerEmail: m.email, buyerPhone: phone() }, m.cookie);

test('checkout options: value, limits and points this order would earn', async () => {
  const m = await member(1000);
  const d = (await call('GET', '/api/rewards/checkout?kind=tickets&subtotalKobo=500000', undefined, { Cookie: m.cookie })).data;
  assert.equal(d.available, true); assert.equal(d.pointValueKobo, 500); assert.equal(d.maxPercent, 50);
  assert.equal(d.maxPoints, 500, '₦5,000 order: up to ₦2,500 = 500 points'); assert.equal(d.earnEstimate, 50);
  const guest = (await call('GET', '/api/rewards/checkout?kind=tickets&subtotalKobo=500000', undefined, {})).data;
  assert.equal(guest.available, false); assert.equal(guest.signedIn, false);
});

test('pay with points: held, then taken when paid; over the limit refused; no points earned on the points part', async () => {
  const m = await member(1000);
  const ev = await match();
  assert.equal((await basket(m, ev, 600)).status, 400, 'more than 50% of ₦5,000');
  assert.equal((await basket(m, ev, 50)).status, 400, 'below the minimum');
  const r = await basket(m, ev, 400); // ₦2,000 off ₦5,000
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.totalKobo, 300000);
  let d = await me(m.cookie);
  assert.equal(d.balance, 1000, 'held, not taken yet');
  const spend = (await call('GET', '/api/rewards/checkout?kind=tickets&subtotalKobo=500000', undefined, { Cookie: m.cookie })).data;
  assert.equal(spend.balance, 600, 'but it cannot be spent twice');
  assert.equal(await webhook(r.data.reference, 300000), 200);
  d = await me(m.cookie);
  assert.equal(d.balance, 600 + 50, 'points taken; first-purchase bonus added');
  assert.equal(d.pending, 30, 'ticket points on the ₦3,000 paid in naira only');
  assert.equal(await webhook(r.data.reference, 300000, 'refund.processed'), 200);
  d = await me(m.cookie);
  assert.equal(d.balance, 1000, 'refund: the 400 points come back and the bonus is removed');
});
