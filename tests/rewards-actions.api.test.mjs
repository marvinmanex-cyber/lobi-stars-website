// Lobi Stars Rewards, one-off actions: newsletter sign-up, match alerts,
// first purchase (once each; the first-purchase bonus follows a refund) and
// reading the Match Day Programme (when one is live).
// Needs the local Pages dev server (ADMIN_CODE=test-code-123, PAYSTACK_FAKE=1, FANS_DEV_LINKS=1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 9);
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const call = (method, p, body, headers = ADMIN) => fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})), headers: r.headers }));
const pub = (p, body, cookie, extra = {}) => call('POST', p, body, { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip(), ...(cookie ? { Cookie: cookie } : {}), ...extra });
const phone = () => '0803' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const me = cookie => fetch(BASE + '/api/rewards/me', { headers: { Cookie: cookie } }).then(r => r.json());
const sources = async cookie => (await me(cookie)).history.map(h => `${h.source}:${h.points}`);

async function member() {
  const email = `act-${uid()}@example.com`;
  const reg = await pub('/api/fans/register', { firstName: 'Sewuese', surname: 'Orkar', email, confirmEmail: email, phone: phone(), password: 'Lobi-Stars-2026', confirmPassword: 'Lobi-Stars-2026', agree: true, joinRewards: true, rewardsAgree: true });
  await fetch(reg.data.devLink.replace('https://lobistarsfc.com', BASE), { redirect: 'manual' });
  return { email, cookie: (await pub('/api/auth/login', { email, password: 'Lobi-Stars-2026' })).headers.get('set-cookie').split(';')[0] };
}

test('newsletter sign-up and match alerts: points once each', async () => {
  const m = await member();
  const sign = () => pub('/api/newsletter', { fullName: 'Sewuese Orkar', phone: phone(), email: m.email, confirmEmail: m.email, consent: true });
  assert.equal((await sign()).status, 200); assert.equal((await sign()).status, 200);
  const sub = { endpoint: `https://push.example.com/${uid()}`, keys: { p256dh: 'x'.repeat(40), auth: 'y'.repeat(16) } };
  assert.equal((await pub('/api/push/subscribe', { subscription: sub, prefs: { match: true } }, m.cookie)).status, 200);
  assert.equal((await pub('/api/push/subscribe', { subscription: { ...sub, endpoint: `https://push.example.com/${uid()}` }, prefs: { match: true } }, m.cookie)).status, 200);
  const s = await sources(m.cookie);
  assert.equal(s.filter(x => x === 'newsletter:20').length, 1);
  assert.equal(s.filter(x => x === 'alerts:10').length, 1);
  assert.equal((await me(m.cookie)).balance, 80);
});

test('first purchase bonus: once, and taken back if that payment is refunded', async () => {
  const m = await member();
  const ev = (await call('POST', '/api/admin/events', { home_team: 'Lobi Stars FC', away_team: `Action Test ${uid()}`, competition: 'Friendly', venue: 'McCarthy Stadium, Makurdi', event_date: new Date(Date.now() + 60 * 3600e3).toISOString(), vip_price_kobo: 500000, premium_price_kobo: 200000, regular_price_kobo: 100000, active: true, is_home: true })).data.id;
  await call('PUT', `/api/admin/tickets/match/${ev}`, { isOnSale: true });
  const buy = async () => {
    const r = await pub('/api/tickets/basket', { lines: [{ eventId: ev, tier: 'Regular', quantity: 1 }], buyerName: 'Sewuese Orkar', buyerEmail: m.email, buyerPhone: phone() });
    const raw = JSON.stringify({ event: 'charge.success', data: { reference: r.data.reference, amount: r.data.totalKobo, currency: 'NGN' } });
    await fetch(`${BASE}/api/paystack-webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || 'sk_test_local').update(raw).digest('hex') }, body: raw });
    return r.data.reference;
  };
  const ref1 = await buy(); await buy();
  assert.equal((await sources(m.cookie)).filter(x => x === 'first_purchase:50').length, 1, 'once only');
  assert.equal((await me(m.cookie)).balance, 100);
  const order = (await call('GET', `/api/admin/tickets/orders?q=${ref1}`)).data.orders[0];
  assert.equal((await call('POST', `/api/admin/tickets/orders/${encodeURIComponent(order.id)}/refund`, { reason: 'Test' })).status, 200);
  assert.equal((await me(m.cookie)).balance, 50, 'bonus taken back with the refunded payment');
});

test('reading the Match Day Programme (when one is live): points once per programme', async t => {
  const cur = (await call('GET', '/api/programme/current', undefined, {})).data;
  const slug = cur?.programme?.slug || cur?.slug;
  if (!slug) return t.skip('no live programme on this server');
  const m = await member();
  const open = () => pub(`/api/programme/${slug}/event`, { type: 'open' }, m.cookie, { Origin: BASE });
  await open(); await open();
  assert.equal((await sources(m.cookie)).filter(x => x === 'programme:5').length, 1);
});
