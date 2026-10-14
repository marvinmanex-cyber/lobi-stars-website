// Lobi Stars Rewards, Phase 1: joining (new fan at sign-up, existing fan with
// one click), terms required, bonuses only after email verification, welcome
// and profile bonuses awarded once (idempotent ledger), member numbers.
// Needs the local Pages dev server with --binding FANS_DEV_LINKS=1.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const uid = () => Math.random().toString(36).slice(2, 10);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const phone = () => `0803${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
const post = (path, body, cookie) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp(), ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body), redirect: 'manual' })
  .then(async r => ({ status: r.status, data: await r.json().catch(() => ({})), headers: r.headers }));
const me = cookie => fetch(BASE + '/api/rewards/me', { headers: cookie ? { Cookie: cookie } : {} }).then(r => r.json());
const fan = (over = {}) => { const email = `rw-${uid()}@example.com`; return { firstName: 'Terna', surname: 'Akaa', email, confirmEmail: email, phone: phone(), password: 'Lobi-Stars-2026', confirmPassword: 'Lobi-Stars-2026', agree: true, ...over }; };

/** Registers, verifies the email and logs in. Returns the session cookie. */
async function verifiedFan(over = {}) {
  const f = fan(over);
  const reg = await post('/api/fans/register', f);
  assert.equal(reg.status, 200, JSON.stringify(reg.data));
  assert.ok(reg.data.devLink, 'start the dev server with --binding FANS_DEV_LINKS=1');
  const login1 = await post('/api/auth/login', { email: f.email, password: f.password });
  await fetch(reg.data.devLink.replace('https://lobistarsfc.com', BASE), { redirect: 'manual' });
  const login = await post('/api/auth/login', { email: f.email, password: f.password });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  return { cookie: login.headers.get('set-cookie').split(';')[0], unverifiedLogin: login1.status, f };
}

test('guests: not signed in; joining needs a login', async () => {
  const d = await me();
  assert.equal(d.signedIn, false); assert.equal(typeof d.live, 'boolean');
  assert.equal((await post('/api/rewards/join', { agree: true })).status, 401);
});

test('new fan: "Also join" needs the Rewards Terms; welcome bonus only after verification', async () => {
  const bad = await post('/api/fans/register', fan({ joinRewards: true }));
  assert.equal(bad.status, 400); assert.ok(bad.data.errors.rewardsAgree);
  const { cookie } = await verifiedFan({ joinRewards: true, rewardsAgree: true });
  const d = await me(cookie);
  assert.equal(d.joined, true); assert.equal(d.verified, true);
  assert.match(d.memberNo, /^LSR-\d{6}$/);
  assert.equal(d.balance, 50, JSON.stringify(d.history));
  assert.equal(d.history[0].description, 'Welcome to Lobi Stars Rewards');
  assert.equal(d.history[0].type, 'BONUS'); assert.equal(d.history[0].status, 'AVAILABLE');
});

test('existing fan joins with one click (terms required); joining twice changes nothing', async () => {
  const { cookie } = await verifiedFan();
  assert.equal((await me(cookie)).joined, false);
  assert.equal((await post('/api/rewards/join', {}, cookie)).status, 400, 'terms not ticked');
  const j = await post('/api/rewards/join', { agree: true }, cookie);
  assert.equal(j.status, 200); assert.equal(j.data.balance, 50);
  const j2 = await post('/api/rewards/join', { agree: true }, cookie);
  assert.equal(j2.data.memberNo, j.data.memberNo); assert.equal(j2.data.balance, 50, 'no second welcome bonus');
});

test('profile bonus: state + date of birth, once', async () => {
  const { cookie } = await verifiedFan({ joinRewards: true, rewardsAgree: true });
  assert.equal((await post('/api/rewards/profile', { state: 'Benue', dateOfBirth: '2031-01-01' }, cookie)).status, 400, 'future date');
  assert.equal((await post('/api/rewards/profile', { state: 'Atlantis', dateOfBirth: '1995-04-12' }, cookie)).status, 400, 'not a Nigerian state');
  const p = await post('/api/rewards/profile', { state: 'Benue', dateOfBirth: '1995-04-12' }, cookie);
  assert.equal(p.status, 200); assert.equal(p.data.awarded, true); assert.equal(p.data.balance, 70);
  const p2 = await post('/api/rewards/profile', { state: 'Lagos', dateOfBirth: '1995-04-12' }, cookie);
  assert.equal(p2.data.awarded, false); assert.equal(p2.data.balance, 70);
  const d = await me(cookie);
  assert.equal(d.profileBonusDone, true); assert.equal(d.profile.state, 'Lagos');
  assert.deepEqual(d.history.map(h => h.points), [20, 50]);
});

test('member numbers are different for each member', async () => {
  const a = await verifiedFan({ joinRewards: true, rewardsAgree: true });
  const b = await verifiedFan({ joinRewards: true, rewardsAgree: true });
  assert.notEqual((await me(a.cookie)).memberNo, (await me(b.cookie)).memberNo);
});
