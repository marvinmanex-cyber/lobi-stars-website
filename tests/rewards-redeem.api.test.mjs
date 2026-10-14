// Lobi Stars Rewards, redeeming: catalogue with "you need X more points";
// voucher (single-use code, staff mark it used); double click and two tabs
// can't double-spend; free match ticket issued through the ticketing system;
// airtime delivered, or retried then points returned; big rewards need the
// emailed code and go to the fulfilment queue; out of stock; not before launch.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123, FANS_DEV_LINKS=1,
// PAYSTACK_FAKE=1 and VTU_FAKE=1 (numbers ending 0000 fail). Switches Rewards live
// for the test, then puts the settings back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 9);
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const call = (method, p, body, headers = ADMIN) => fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})), headers: r.headers }));
const pub = (p, body, cookie) => call('POST', p, body, { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip(), ...(cookie ? { Cookie: cookie } : {}) });
const get = (p, cookie) => call('GET', p, undefined, cookie ? { Cookie: cookie } : {});
const phone = () => '0803' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const key = () => `k-${uid()}-${uid()}`;
const bal = async cookie => (await get('/api/rewards/me', cookie)).data.balance;

let saved;
before(async () => {
  saved = (await call('GET', '/api/admin/rewards')).data.settings;
  assert.equal((await call('PUT', '/api/admin/rewards', { settings: { live: true } })).status, 200);
});
after(async () => { await call('PUT', '/api/admin/rewards', { settings: saved }); });

/** A verified Rewards member with `points` Pride Points (welcome bonus + an adjustment). */
async function member(points) {
  const email = `rd-${uid()}@example.com`;
  const reg = await pub('/api/fans/register', { firstName: 'Aondona', surname: 'Ikyaa', email, confirmEmail: email, phone: phone(), password: 'Lobi-Stars-2026', confirmPassword: 'Lobi-Stars-2026', agree: true, joinRewards: true, rewardsAgree: true });
  await fetch(reg.data.devLink.replace('https://lobistarsfc.com', BASE), { redirect: 'manual' });
  const cookie = (await pub('/api/auth/login', { email, password: 'Lobi-Stars-2026' })).headers.get('set-cookie').split(';')[0];
  const look = (await call('GET', `/api/admin/rewards/member?q=${encodeURIComponent(email)}`)).data;
  if (points !== 50) assert.equal((await call('POST', '/api/admin/rewards/member', { memberId: look.member.id, action: 'adjust', points: points - 50, reason: 'Test points' })).status, 200);
  return { cookie, email, id: look.member.id };
}
const redeem = (cookie, itemId, extra = {}) => pub('/api/rewards/redeem', { itemId, key: key(), ...extra }, cookie);

test('catalogue: seeded rewards; "you need X more points"; guests see prices only', async () => {
  const guest = (await get('/api/rewards/catalogue')).data;
  assert.ok(guest.items.length >= 8); assert.equal(guest.items[0].canRedeem, null);
  const m = await member(150);
  const d = (await get('/api/rewards/catalogue', m.cookie)).data;
  assert.equal(d.balance, 150);
  assert.equal(d.items.find(i => i.id === 'airtime-500').canRedeem, true);
  assert.equal(d.items.find(i => i.id === 'ticket-popular').reason, 'You need 50 more points');
  assert.equal(d.items.find(i => i.id === 'pitchside').reason, 'Out of stock');
  assert.equal((await redeem(m.cookie, 'pitchside')).status, 409);
});

test('voucher: unique single-use code; a double click spends once; staff mark it used once', async () => {
  const m = await member(1000);
  const k = key();
  const [a, b] = await Promise.all([pub('/api/rewards/redeem', { itemId: 'food-1500', key: k }, m.cookie), pub('/api/rewards/redeem', { itemId: 'food-1500', key: k }, m.cookie)]);
  assert.equal(a.status, 200, JSON.stringify(a.data)); assert.equal(b.status, 200);
  assert.equal(a.data.redemption.id, b.data.redemption.id, 'same click = same redemption');
  assert.match(a.data.redemption.voucherCode, /^LSR-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(await bal(m.cookie), 700, 'points taken once');
  const code = a.data.redemption.voucherCode;
  assert.equal((await call('GET', `/api/admin/rewards/fulfilment?code=${code}`)).data.voucher.status, 'issued');
  assert.equal((await call('POST', '/api/admin/rewards/fulfilment', { id: a.data.redemption.id, action: 'use' })).status, 200);
  assert.equal((await call('POST', '/api/admin/rewards/fulfilment', { id: a.data.redemption.id, action: 'use' })).status, 409, 'used once only');
  const w = (await get('/api/rewards/wallet', m.cookie)).data.items;
  assert.equal(w[0].status, 'used');
});

test('two tabs at once with points for only one: only one redemption', async () => {
  const m = await member(300);
  const rs = await Promise.all([redeem(m.cookie, 'food-1500'), redeem(m.cookie, 'food-1500')]);
  assert.deepEqual(rs.map(r => r.status).sort(), [200, 409]);
  assert.equal(await bal(m.cookie), 0);
});

test('free match ticket: issued as a QR ticket through the ticketing system', async () => {
  const m = await member(250);
  const ev = await call('POST', '/api/admin/events', { home_team: 'Lobi Stars FC', away_team: `Reward Ticket ${uid()}`, competition: 'Friendly', venue: 'McCarthy Stadium, Makurdi',
    event_date: new Date(Date.now() + 72 * 3600e3).toISOString(), vip_price_kobo: 500000, premium_price_kobo: 200000, regular_price_kobo: 100000, active: true, is_home: true });
  await call('PUT', `/api/admin/tickets/match/${ev.data.id}`, { isOnSale: true, capacities: { Regular: 1 } });
  assert.equal((await redeem(m.cookie, 'ticket-popular', {})).status, 400, 'a match must be chosen');
  const r = await redeem(m.cookie, 'ticket-popular', { eventId: ev.data.id });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.redemption.status, 'issued'); assert.ok(r.data.redemption.ticketOrderId);
  const left = (await get('/api/tickets/catalogue')).data.matches.find(x => x.id === ev.data.id).tiers.find(t => t.tier === 'Regular').left;
  assert.equal(left, 0, 'the seat is taken');
  const m2 = await member(250);
  assert.equal((await redeem(m2.cookie, 'ticket-popular', { eventId: ev.data.id })).status, 409, 'sold out: no points taken');
  assert.equal(await bal(m2.cookie), 250);
});

test('airtime: delivered; a failing number is retried, then the points come back', async () => {
  const m = await member(300);
  const ok = await redeem(m.cookie, 'airtime-500', { network: 'mtn' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data)); assert.equal(ok.data.redemption.status, 'delivered');
  assert.equal((await redeem(m.cookie, 'airtime-500', { network: 'xyz' })).status, 400);
  const bad = await redeem(m.cookie, 'airtime-500', { network: 'glo', phone: '08031230000' });
  assert.equal(bad.data.redemption.status, 'retry');
  assert.equal(await bal(m.cookie), 100);
  for (let i = 0; i < 2; i++) await call('POST', '/api/admin/rewards/fulfilment', { id: bad.data.redemption.id, action: 'retry' });
  const w = (await get('/api/rewards/wallet', m.cookie)).data.items.find(x => x.id === bad.data.redemption.id);
  assert.equal(w.status, 'refunded', 'after 3 tries');
  assert.equal(await bal(m.cookie), 200, 'points returned');
  const me = (await get('/api/rewards/me', m.cookie)).data;
  assert.equal(me.tier.earned, 50, 'returned points do not count towards the tier');
});

test('big rewards need the emailed code, then go to the fulfilment queue', async () => {
  const m = await member(1200);
  const first = await redeem(m.cookie, 'official-cap', { notes: 'Size L' });
  assert.equal(first.status, 428); assert.equal(first.data.needCode, true);
  const c = await pub('/api/rewards/redeem', { action: 'code', itemId: 'official-cap' }, m.cookie);
  assert.match(c.data.devCode, /^\d{6}$/);
  const wrong = c.data.devCode === '000000' ? '111111' : '000000';
  assert.equal((await redeem(m.cookie, 'official-cap', { code: wrong })).status, 400);
  const r = await redeem(m.cookie, 'official-cap', { code: c.data.devCode, notes: 'Size L' });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.redemption.status, 'requested');
  const q = (await call('GET', '/api/admin/rewards/fulfilment?view=queue')).data.queue.find(x => x.id === r.data.redemption.id);
  assert.equal(q.fan.email, m.email); assert.equal(q.notes, 'Size L');
  assert.equal((await call('POST', '/api/admin/rewards/fulfilment', { id: q.id, action: 'collect' })).status, 200);
  assert.equal((await redeem(m.cookie, 'official-cap', { code: c.data.devCode })).status, 409, 'one per fan');
});

test('admin catalogue: validation and adding a reward; nothing before launch', async () => {
  assert.equal((await call('POST', '/api/admin/rewards/catalogue', { item: { type: 'voucher', name: 'X', points: 10 } })).status, 400);
  const add = await call('POST', '/api/admin/rewards/catalogue', { item: { type: 'airtime', name: `Test airtime ${uid()}`, points: 50, amountNaira: 200, description: 'Test' } });
  assert.equal(add.status, 200, JSON.stringify(add.data));
  assert.equal((await call('POST', '/api/admin/rewards/catalogue', { item: { id: add.data.item.id, active: false } })).status, 200);
  assert.ok(!(await get('/api/rewards/catalogue')).data.items.some(i => i.id === add.data.item.id), 'switched off: hidden from fans');
  const m = await member(200);
  await call('PUT', '/api/admin/rewards', { settings: { live: false } });
  assert.equal((await redeem(m.cookie, 'airtime-500', { network: 'mtn' })).status, 403);
  await call('PUT', '/api/admin/rewards', { settings: { live: true } });
});
