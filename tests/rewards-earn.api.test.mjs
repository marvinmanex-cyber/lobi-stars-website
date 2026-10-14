// Lobi Stars Rewards, earning: ticket points pending until full-time then
// available; webhook replay doesn't double-award; refund cancels; gate scan
// attendance + 3-in-a-row bonus; dispute reverses available points; referral
// paid only after the friend's first purchase, self-referral flagged; admin
// settings validation, adjust with a reason, member lookup.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123,
// PAYSTACK_SECRET_KEY=sk_test_local, PAYSTACK_FAKE=1, STAFF_SCAN_CODE=scan-test, FANS_DEV_LINKS=1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 9);
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const call = (method, p, body, headers = ADMIN) => fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})), headers: r.headers }));
const pub = (p, body, cookie) => call('POST', p, body, { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip(), ...(cookie ? { Cookie: cookie } : {}) });
const H = 3600e3;
const phone = () => '0803' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const me = cookie => fetch(BASE + '/api/rewards/me', { headers: { Cookie: cookie } }).then(r => r.json());
const signed = (body) => {
  const raw = JSON.stringify(body);
  return fetch(`${BASE}/api/paystack-webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || 'sk_test_local').update(raw).digest('hex') }, body: raw }).then(r => r.status);
};
const paid = (reference, amount) => signed({ event: 'charge.success', data: { reference, amount, currency: 'NGN' } });
const gate = id => call('POST', '/api/validate-ticket', { ticketId: id, staffCode: process.env.STAFF_SCAN_CODE || 'scan-test', station: 'test' }, { 'Content-Type': 'application/json' });

/** A verified fan who joined Rewards. Returns { cookie, email, memberNo }. */
async function member(extra = {}) {
  const email = `earn-${uid()}@example.com`;
  const reg = await pub('/api/fans/register', { firstName: 'Terver', surname: `Iorbee${uid()}`, email, confirmEmail: email, phone: phone(), password: 'Lobi-Stars-2026', confirmPassword: 'Lobi-Stars-2026', agree: true, joinRewards: true, rewardsAgree: true, device: `dev-${uid()}-${uid()}`, ...extra });
  assert.equal(reg.status, 200, JSON.stringify(reg.data));
  await fetch(reg.data.devLink.replace('https://lobistarsfc.com', BASE), { redirect: 'manual' });
  const login = await pub('/api/auth/login', { email, password: 'Lobi-Stars-2026' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  return { cookie, email, memberNo: (await me(cookie)).memberNo };
}
async function match(hoursAhead) {
  const r = await call('POST', '/api/admin/events', { home_team: 'Lobi Stars FC', away_team: `Rewards Test ${uid()}`, competition: 'Friendly', venue: 'McCarthy Stadium, Makurdi',
    event_date: new Date(Date.now() + hoursAhead * H).toISOString(), vip_price_kobo: 500000, premium_price_kobo: 200000, regular_price_kobo: 100000, active: true, is_home: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await call('PUT', `/api/admin/tickets/match/${r.data.id}`, { isOnSale: true, maxPerOrder: 10 })).status, 200);
  return r.data.id;
}
async function buy(email, eventId, quantity = 2) {
  const r = await pub('/api/tickets/basket', { lines: [{ eventId, tier: 'Regular', quantity }], buyerName: 'Terver Iorbee', buyerEmail: email, buyerPhone: phone() });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await paid(r.data.reference, r.data.totalKobo), 200);
  const done = (await call('GET', `/api/tickets/basket?reference=${r.data.reference}`, undefined, {})).data;
  return { reference: r.data.reference, total: r.data.totalKobo, tickets: done.matches[0].tickets };
}

test('tickets: pending until full-time, then available; replayed webhook adds nothing; dispute takes them back', async () => {
  const m = await member();
  const ev = await match(48);
  const b = await buy(m.email, ev, 2); // 2 x ₦1,000 -> 20 points at 1 per ₦100
  assert.equal(await paid(b.reference, b.total), 200, 'replay');
  let d = await me(m.cookie);
  assert.equal(d.pending, 20); assert.equal(d.balance, 100, 'welcome 50 + first-purchase bonus 50 are available');
  assert.equal((await call('PUT', `/api/admin/match-centre/${ev}`, { status: 'full-time', home_score: 2, away_score: 1 })).status, 200);
  d = await me(m.cookie);
  assert.equal(d.pending, 0); assert.equal(d.balance, 120, JSON.stringify(d.history.slice(0, 3)));
  assert.equal(await signed({ event: 'charge.dispute.create', data: { transaction: { reference: b.reference } } }), 200);
  assert.equal(await signed({ event: 'charge.dispute.create', data: { transaction: { reference: b.reference } } }), 200, 'repeat');
  d = await me(m.cookie);
  assert.equal(d.balance, 50, 'dispute removed the 20 ticket points and the first-purchase bonus, once');
  assert.ok(d.history.some(h => h.type === 'REVERSE' && h.points === -20));
});

test('refunded tickets: the pending points are cancelled', async () => {
  const m = await member();
  const ev = await match(50);
  const b = await buy(m.email, ev, 3);
  assert.equal((await me(m.cookie)).pending, 30);
  const orders = (await call('GET', `/api/admin/tickets/orders?q=${encodeURIComponent(b.reference)}`)).data.orders;
  assert.equal((await call('POST', `/api/admin/tickets/orders/${encodeURIComponent(orders[0].id)}/refund`, { reason: 'Test refund' })).status, 200);
  const d = await me(m.cookie);
  assert.equal(d.pending, 0); assert.equal(d.balance, 50, 'first-purchase bonus taken back too');
  assert.ok(d.history.some(h => h.status === 'REVERSED'));
});

test('gate scan: attendance once per match (two tickets), and the 3-in-a-row bonus', async () => {
  const m = await member();
  // Same Nigerian day (tickets only scan on match day); seconds apart so matches from earlier test runs can't fall in between.
  const toMidnight = (86400e3 - ((Date.now() + 3600e3) % 86400e3)) / 3600e3;
  const h = Math.max(0.01, Math.min(0.3, toMidnight - 0.01));
  const evs = [await match(h), await match(h + 0.001), await match(h + 0.002)];
  for (let i = 0; i < 3; i++) {
    const b = await buy(m.email, evs[i], 2);
    for (const t of b.tickets) { const g = await gate(t.id); assert.equal(g.data.valid, true, JSON.stringify(g.data)); }
  }
  const d = await me(m.cookie);
  const att = d.history.filter(h => h.source === 'attendance');
  assert.equal(att.filter(h => h.points === 30).length, 3, 'once per match, not per ticket');
  assert.equal(att.filter(h => h.points === 100).length, 1, JSON.stringify(att));
});

test('referral: paid only after the friend verifies and buys; self-referral flagged', async () => {
  const a = await member({ device: 'dev-referrer-xyz' });
  const friend = await member({ ref: a.memberNo });
  const before = (await me(a.cookie)).balance;
  assert.equal(before, 50, 'nothing yet: the friend has not bought anything');
  await buy(friend.email, await match(52), 1);
  assert.equal((await me(a.cookie)).balance, 200, 'referral 150 after the first paid purchase');
  await buy(friend.email, await match(53), 1);
  assert.equal((await me(a.cookie)).balance, 200, 'only once');
  const sneaky = await member({ ref: a.memberNo, device: 'dev-referrer-xyz' });
  await buy(sneaky.email, await match(54), 1);
  assert.equal((await me(a.cookie)).balance, 200, 'same device: flagged, not paid');
  const look = (await call('GET', `/api/admin/rewards/member?q=${a.memberNo}`)).data;
  assert.deepEqual(look.referrals.map(r => r.status).sort(), ['awarded', 'flagged']);
});

test('admin: settings validation, adjust with a reason, suspend, member lookup, run now', async () => {
  const s = (await call('GET', '/api/admin/rewards')).data;
  assert.equal(s.settings.live, false); assert.equal(s.settings.ticketsPer100, 1); assert.equal(s.settings.engagementMonthlyCap, 200);
  assert.equal((await call('PUT', '/api/admin/rewards', { settings: { attendance: -5 } })).status, 400);
  assert.equal((await call('GET', '/api/admin/rewards', undefined, { 'Content-Type': 'application/json' })).status, 401);
  const m = await member();
  const look = (await call('GET', `/api/admin/rewards/member?q=${encodeURIComponent(m.email)}`)).data;
  assert.equal(look.member.memberNo, m.memberNo);
  assert.equal((await call('POST', '/api/admin/rewards/member', { memberId: look.member.id, action: 'adjust', points: 25 })).status, 400, 'reason required');
  const adj = await call('POST', '/api/admin/rewards/member', { memberId: look.member.id, action: 'adjust', points: 25, reason: 'Goodwill after a gate delay' });
  assert.equal(adj.status, 200); assert.equal(adj.data.balance, 75);
  assert.equal((await me(m.cookie)).history[0].description, 'Adjustment by the club: Goodwill after a gate delay');
  assert.equal((await call('POST', '/api/admin/rewards/member', { memberId: look.member.id, action: 'suspend', reason: 'Test' })).status, 200);
  const ev = await match(55); await buy(m.email, ev, 1);
  assert.equal((await me(m.cookie)).pending, 0, 'suspended members earn nothing');
  assert.equal((await call('POST', '/api/admin/rewards/run', {})).status, 200);
});
