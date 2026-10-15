// Lobi Stars Rewards notifications: on-site messages for a redeemed reward,
// points returned, a voucher about to expire and points about to expire; the
// header unread count; mark read; email choices (defaults and saving); a job
// that runs twice never notifies twice.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123, FANS_DEV_LINKS=1.
// Switches Rewards live for the test, then puts the settings back. Edits the LOCAL D1 database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 9);
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const call = (method, p, body, headers = ADMIN) => fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})), headers: r.headers }));
const pub = (p, body, cookie) => call('POST', p, body, { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip(), ...(cookie ? { Cookie: cookie } : {}) });
const get = (p, cookie) => call('GET', p, undefined, cookie ? { Cookie: cookie } : {});
const phone = () => '0803' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const localSql = sql => execSync(`npx wrangler d1 execute lobi-stars-tickets --local --command "${sql.replace(/"/g, '\\"')}"`, { stdio: 'pipe' });

let saved;
before(async () => {
  saved = (await call('GET', '/api/admin/rewards')).data.settings;
  assert.equal((await call('PUT', '/api/admin/rewards', { settings: { live: true } })).status, 200);
});
after(async () => { await call('PUT', '/api/admin/rewards', { settings: saved }); });

async function member(points) {
  const email = `nt-${uid()}@example.com`;
  const reg = await pub('/api/fans/register', { firstName: 'Doosuur', surname: 'Akaa', email, confirmEmail: email, phone: phone(), password: 'Lobi-Stars-2026', confirmPassword: 'Lobi-Stars-2026', agree: true, joinRewards: true, rewardsAgree: true });
  await fetch(reg.data.devLink.replace('https://lobistarsfc.com', BASE), { redirect: 'manual' });
  const cookie = (await pub('/api/auth/login', { email, password: 'Lobi-Stars-2026' })).headers.get('set-cookie').split(';')[0];
  const look = (await call('GET', `/api/admin/rewards/member?q=${encodeURIComponent(email)}`)).data;
  if (points !== 50) assert.equal((await call('POST', '/api/admin/rewards/member', { memberId: look.member.id, action: 'adjust', points: points - 50, reason: 'Test points' })).status, 200);
  return { cookie, id: look.member.id };
}
const notes = cookie => get('/api/rewards/notifications', cookie).then(r => r.data);

test('redeemed reward and points returned: messages, unread count, mark read', async () => {
  const m = await member(1000);
  assert.equal((await notes(m.cookie)).unread, 0);
  const red = (await pub('/api/rewards/redeem', { itemId: 'food-1500', key: `k-${uid()}-${uid()}` }, m.cookie)).data.redemption;
  let n = await notes(m.cookie);
  assert.equal(n.unread, 1);
  assert.match(n.items[0].title, /^You redeemed: /);
  assert.ok(n.items[0].body.includes(red.voucherCode));
  assert.equal((await get('/api/rewards/balance', m.cookie)).data.unread, 1, 'header dot');
  assert.equal((await call('POST', '/api/admin/rewards/fulfilment', { id: red.id, action: 'refund', note: 'Stand closed' })).status, 200);
  n = await notes(m.cookie);
  assert.equal(n.unread, 2);
  assert.match(n.items[0].title, /^Points returned: /); assert.match(n.items[0].body, /Stand closed/);
  assert.equal((await pub('/api/rewards/notifications', { action: 'read', id: n.items[0].id }, m.cookie)).data.changed, 1);
  assert.equal((await notes(m.cookie)).unread, 1);
  await pub('/api/rewards/notifications', { action: 'read' }, m.cookie);
  assert.equal((await notes(m.cookie)).unread, 0);
  assert.equal((await get('/api/rewards/notifications')).status, 401);
});

test('email choices: defaults, save, only known kinds', async () => {
  const m = await member(50);
  const n = await notes(m.cookie);
  assert.deepEqual(n.email, { points: false, tier: true, rewards: true, expiry: true });
  assert.deepEqual(Object.keys(n.kinds), ['points', 'tier', 'rewards', 'expiry']);
  const r = await pub('/api/rewards/notifications', { action: 'prefs', email: { points: true, tier: false, rewards: true, expiry: 'yes', other: true } }, m.cookie);
  assert.deepEqual(r.data.email, { points: true, tier: false, rewards: true, expiry: false });
  assert.deepEqual((await notes(m.cookie)).email, { points: true, tier: false, rewards: true, expiry: false });
});

test('voucher about to expire and points about to expire: one message each, even when the job runs twice', async () => {
  const m = await member(1000);
  const red = (await pub('/api/rewards/redeem', { itemId: 'food-1500', key: `k-${uid()}-${uid()}` }, m.cookie)).data.redemption;
  localSql(`UPDATE rewards_redemptions SET expires_at = '${new Date(Date.now() + 3 * 864e5).toISOString()}' WHERE id = '${red.id}'`);
  localSql(`UPDATE rewards_ledger SET created_at = datetime('now', '-11 months', '-10 days') WHERE member_id = '${m.id}'`);
  await call('POST', '/api/admin/rewards/run');
  await call('POST', '/api/admin/rewards/run');
  const n = await notes(m.cookie);
  const titles = n.items.map(i => i.title);
  assert.equal(titles.filter(t => t === 'Your voucher expires soon').length, 1, JSON.stringify(titles));
  assert.equal(titles.filter(t => t === 'Your Star Points expire soon').length, 1, JSON.stringify(titles));
  assert.ok(n.items.find(i => i.title === 'Your voucher expires soon').body.includes(red.voucherCode));
});
