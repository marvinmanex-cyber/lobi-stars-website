// "Delete my data" (NDPA request, Admin › Fans › Delete) also clears Lobi
// Stars Rewards: membership, messages and referral links go; the points history
// and redeemed rewards stay only as anonymous totals.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123, FANS_DEV_LINKS=1.
// Switches Rewards live for the test, then puts the settings back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 9);
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const call = (method, p, body, headers = ADMIN) => fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})), headers: r.headers }));
const pub = (p, body, cookie) => call('POST', p, body, { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip(), ...(cookie ? { Cookie: cookie } : {}) });

let saved;
before(async () => {
  saved = (await call('GET', '/api/admin/rewards')).data.settings;
  assert.equal((await call('PUT', '/api/admin/rewards', { settings: { live: true } })).status, 200);
});
after(async () => { await call('PUT', '/api/admin/rewards', { settings: saved }); });

test('deleting a fan clears their Rewards data but keeps anonymous totals', async () => {
  const email = `er-${uid()}@example.com`;
  const reg = await pub('/api/fans/register', { firstName: 'Ngodoo', surname: 'Ityo', email, confirmEmail: email, phone: '0803' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0'), password: 'Lobi-Stars-2026', confirmPassword: 'Lobi-Stars-2026', agree: true, joinRewards: true, rewardsAgree: true });
  await fetch(reg.data.devLink.replace('https://lobistarsfc.com', BASE), { redirect: 'manual' });
  const cookie = (await pub('/api/auth/login', { email, password: 'Lobi-Stars-2026' })).headers.get('set-cookie').split(';')[0];
  const look = (await call('GET', `/api/admin/rewards/member?q=${encodeURIComponent(email)}`)).data;
  await call('POST', '/api/admin/rewards/member', { memberId: look.member.id, action: 'adjust', points: 950, reason: 'Test points' });
  assert.equal((await pub('/api/rewards/redeem', { itemId: 'food-1500', key: `k-${uid()}-${uid()}` }, cookie)).status, 200);
  const before = (await call('GET', '/api/admin/rewards/analytics')).data.summary;

  const contact = (await call('GET', `/api/admin/fans?q=${encodeURIComponent(email)}`)).data.rows.find(r => r.email === email);
  assert.ok(contact, 'in the fan database');
  assert.equal((await call('DELETE', `/api/admin/fans/${contact.id}`)).status, 200);

  assert.equal((await call('GET', `/api/admin/rewards/member?q=${encodeURIComponent(email)}`)).status, 404, 'no longer a Rewards member');
  const after = (await call('GET', '/api/admin/rewards/analytics')).data.summary;
  assert.equal(after.members, before.members - 1);
  assert.equal(after.issued, before.issued, 'points issued stay in the totals');
  assert.equal(after.used, before.used, 'points used stay in the totals');
  const all = (await call('GET', '/api/admin/rewards/analytics')).data;
  assert.ok(!JSON.stringify(all).includes(email), 'no trace in reports or checks');
});
