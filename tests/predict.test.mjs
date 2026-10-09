// Predict & Win tests (Phase 7). Needs the local Pages dev server with
// FANS_DEV_LINKS=1 and ADMIN_CODE=test-code-123 (see tests/fans.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 10);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const r7 = () => String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const H = 3600e3;

async function post(path, body, cookie) {
  const res = await fetch(BASE + path, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp(), ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})), headers: res.headers };
}
const get = (path, cookie) => fetch(BASE + path, { headers: cookie ? { Cookie: cookie } : {} }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));

async function fan(first = 'Terna', last = 'Akaa') {
  const email = `pw-${uid()}@example.com`;
  const phone = `0803${r7()}`;
  const reg = await post('/api/fans/register', {
    firstName: first, surname: last, email, confirmEmail: email, phone,
    password: 'Lobi-Stars-2026', confirmPassword: 'Lobi-Stars-2026', agree: true, marketing: false,
  });
  assert.ok(reg.data.devLink, 'start the dev server with --binding FANS_DEV_LINKS=1');
  await fetch(reg.data.devLink.replace('https://lobistarsfc.com', BASE), { redirect: 'manual' });
  const login = await post('/api/auth/login', { email, password: 'Lobi-Stars-2026' });
  assert.equal(login.status, 200);
  return { cookie: login.headers.get('set-cookie').split(';')[0], phone, email };
}

async function match(kickoffInMs, over = {}) {
  const res = await fetch(`${BASE}/api/admin/events`, {
    method: 'POST', headers: ADMIN, body: JSON.stringify({
      home_team: 'Lobi Stars FC', away_team: `Predict Test ${uid()}`, competition: 'NNL Conference D',
      venue: 'McCarthy Stadium, Makurdi', event_date: new Date(Date.now() + kickoffInMs).toISOString(),
      vip_price_kobo: 0, premium_price_kobo: 0, regular_price_kobo: 0, active: true, ...over,
    }),
  });
  const { id } = await res.json();
  return (await fetch(`${BASE}/api/admin/match-centre/${id}`, { headers: ADMIN }).then(r => r.json())).match;
}
const predict = (m, home, away, cookie) => post(`/api/matches/${m.slug}/predict`, { home, away }, cookie);
const control = (id, body) => fetch(`${BASE}/api/admin/match-centre/${id}`, { method: 'POST', headers: ADMIN, body: JSON.stringify(body) }).then(r => r.json());
const adminPost = (id, body) => fetch(`${BASE}/api/admin/predictions/${id}`, { method: 'POST', headers: ADMIN, body: JSON.stringify(body) });

test('predictions before the 24-hour window are rejected', async () => {
  const m = await match(30 * H);
  const f = await fan();
  const r = await predict(m, 1, 0, f.cookie);
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'notyet');
  const s = await get(`/api/matches/${m.slug}/predict`, f.cookie);
  assert.equal(s.data.state, 'notyet');
  assert.equal(new Date(s.data.opensAt).getTime(), new Date(m.event_date).getTime() - 24 * H);
});

test('inside the window: one prediction accepted (ms timestamp), a second rejected, then closed at kick-off', async () => {
  const m = await match(2 * H);
  const f = await fan();
  const ok = await predict(m, 2, 1, f.cookie);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.match(ok.data.mine.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  const again = await predict(m, 3, 0, f.cookie);
  assert.equal(again.status, 409);
  assert.equal(again.data.code, 'predicted');
  const mine = await get(`/api/matches/${m.slug}/predict`, f.cookie);
  assert.deepEqual([mine.data.mine.home, mine.data.mine.away], [2, 1], 'cannot be edited');
  assert.equal(mine.data.count, 1);

  // Staff press Start Match early: predictions close straight away.
  await control(m.id, { action: 'kickoff' });
  const late = await predict(m, 1, 1, (await fan()).cookie);
  assert.equal(late.status, 409);
  assert.equal(late.data.code, 'closed');
  await control(m.id, { action: 'fulltime', home_score: 0, away_score: 0 });
});

test('predictions after the scheduled kick-off are rejected even if staff forget to press Start Match', async () => {
  const m = await match(-5 * 60e3);
  const r = await predict(m, 1, 0, (await fan()).cookie);
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'closed');
});

test('validation: scores must be whole numbers from 0 to 20; logged-out fans are refused', async () => {
  const m = await match(2 * H);
  const f = await fan();
  for (const [h, a] of [[-1, 0], [21, 0], [1.5, 0], ['x', 1], [null, 1]]) assert.equal((await predict(m, h, a, f.cookie)).status, 400, `${h}-${a}`);
  assert.equal((await predict(m, 1, 0)).status, 401);
});

test('winner = earliest exact score; staff accounts excluded; disqualification recalculates; public name is masked', async () => {
  const m = await match(2 * H);
  const staff = await fan('Club', 'Insider');
  const first = await fan('Terna', 'Akaa');
  const second = await fan('Ngozi', 'Bello');
  const wrong = await fan('Wrong', 'Guess');
  assert.equal((await predict(m, 2, 1, staff.cookie)).status, 200);
  assert.equal((await predict(m, 2, 1, first.cookie)).status, 200);
  assert.equal((await predict(m, 2, 1, second.cookie)).status, 200);
  assert.equal((await predict(m, 0, 0, wrong.cookie)).status, 200);

  // Flag the earliest entrant as club staff (they can't win).
  const list = await fetch(`${BASE}/api/admin/predictions/${m.id}`, { headers: ADMIN }).then(r => r.json());
  const staffEntry = list.entries.find(e => e.name === 'Club Insider');
  assert.equal((await adminPost(m.id, { action: 'staff', memberId: staffEntry.memberId, isStaff: true })).status, 200);

  await control(m.id, { action: 'kickoff' });
  const ft = await control(m.id, { action: 'fulltime', home_score: 2, away_score: 1 });
  assert.equal(ft.predictionWinner, true);

  const pub = await get(`/api/matches/${m.slug}/predict`, first.cookie);
  assert.equal(pub.data.state, 'result');
  assert.equal(pub.data.result.correct, 3);
  assert.equal(pub.data.result.total, 4);
  assert.match(pub.data.result.winner, /^Terna A\. – 0803\*\*\*\*\d\d$/, 'first name + initial + masked phone');
  assert.ok(!pub.data.result.winner.includes(first.phone.slice(4, 8)));
  assert.equal(pub.data.result.youWon, true);
  const lost = await get(`/api/matches/${m.slug}/predict`, wrong.cookie);
  assert.equal(lost.data.result.youWon, false);
  assert.equal(JSON.stringify(lost.data).includes('@'), false, 'no emails in the public response');

  // Disqualify the winner -> the next earliest exact entry wins.
  const after = await fetch(`${BASE}/api/admin/predictions/${m.id}`, { headers: ADMIN }).then(r => r.json());
  const win = after.entries.find(e => e.winner);
  assert.equal(win.name, 'Terna Akaa');
  assert.equal((await adminPost(m.id, { action: 'disqualify', predictionId: win.id })).status, 400, 'reason required');
  assert.equal((await adminPost(m.id, { action: 'disqualify', predictionId: win.id, reason: 'Duplicate account' })).status, 200);
  const re = await get(`/api/matches/${m.slug}/predict`);
  assert.match(re.data.result.winner, /^Ngozi B\./);

  // Prize paid is recorded with the staff name.
  assert.equal((await adminPost(m.id, { action: 'paid', paid: true })).status, 200);
  const paid = await fetch(`${BASE}/api/admin/predictions/${m.id}`, { headers: ADMIN }).then(r => r.json());
  assert.equal(paid.result.paid, true);
  assert.ok(paid.result.paidBy && paid.result.paidAt);
  const csv = await fetch(`${BASE}/api/admin/predictions/${m.id}?format=csv`, { headers: ADMIN });
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /Submitted \(WAT to the millisecond\),Name,Email,Phone,Prediction/);
});

test('no exact score means no winner', async () => {
  const m = await match(2 * H);
  assert.equal((await predict(m, 3, 3, (await fan()).cookie)).status, 200);
  await control(m.id, { action: 'kickoff' });
  const ft = await control(m.id, { action: 'fulltime', home_score: 1, away_score: 0 });
  assert.equal(ft.predictionWinner, false);
  const pub = await get(`/api/matches/${m.slug}/predict`);
  assert.equal(pub.data.result.winner, null);
  assert.equal(pub.data.result.correct, 0);
});

test('away games have no Predict & Win', async () => {
  const m = await match(2 * H, { home_team: 'Sokoto United FC', away_team: 'Lobi Stars FC' });
  assert.equal((await get(`/api/matches/${m.slug}/predict`)).status, 404);
});
