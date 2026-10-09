// Man of the Match voting tests (Phase 6). Needs the local Pages dev server
// with FANS_DEV_LINKS=1 and ADMIN_CODE=test-code-123 (see tests/fans.test.mjs).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 10);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const r7 = () => String(Math.floor(Math.random() * 1e7)).padStart(7, '0');

async function post(path, body, cookie) {
  const res = await fetch(BASE + path, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp(), ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})), headers: res.headers };
}
const get = (path, cookie) => fetch(BASE + path, { headers: cookie ? { Cookie: cookie } : {} }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));

/** Registers a fan; verifies and logs in unless verify === false. Returns the session cookie. */
async function fan({ verify = true } = {}) {
  const email = `motm-${uid()}@example.com`;
  const reg = await post('/api/fans/register', {
    firstName: 'Vote', surname: 'Tester', email, confirmEmail: email, phone: `0803${r7()}`,
    password: 'Lobi-Stars-2026', confirmPassword: 'Lobi-Stars-2026', agree: true, marketing: false,
  });
  assert.ok(reg.data.devLink, 'start the dev server with --binding FANS_DEV_LINKS=1');
  if (!verify) {
    // Unverified accounts can't log in, so there is no session to vote with.
    const login = await post('/api/auth/login', { email, password: 'Lobi-Stars-2026' });
    assert.equal(login.status, 403);
    return null;
  }
  await fetch(reg.data.devLink.replace('https://lobistarsfc.com', BASE), { redirect: 'manual' });
  const login = await post('/api/auth/login', { email, password: 'Lobi-Stars-2026' });
  assert.equal(login.status, 200);
  return login.headers.get('set-cookie').split(';')[0];
}

let roster = [];
before(async () => {
  roster = await fetch(`${BASE}/data/players.json`).then(r => r.json());
  assert.ok(roster.length >= 3, 'needs at least 3 players in the squad');
});

async function homeMatch(over = {}) {
  const res = await fetch(`${BASE}/api/admin/events`, {
    method: 'POST', headers: ADMIN, body: JSON.stringify({
      home_team: 'Lobi Stars FC', away_team: `MOTM Test ${uid()}`, competition: 'NNL Conference D',
      venue: 'McCarthy Stadium, Makurdi', event_date: new Date(Date.now() + 3600e3).toISOString(),
      vip_price_kobo: 0, premium_price_kobo: 0, regular_price_kobo: 0, active: true, ...over,
    }),
  });
  const { id } = await res.json();
  const { match } = await fetch(`${BASE}/api/admin/match-centre/${id}`, { headers: ADMIN }).then(r => r.json());
  // Squad: first two players starting, third on the bench.
  await fetch(`${BASE}/api/admin/match-centre/${id}`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({
    status: 'scheduled', squad: { starting: [roster[0].slug, roster[1].slug], bench: [roster[2].slug] },
  }) });
  return match;
}
const control = (id, body) => fetch(`${BASE}/api/admin/match-centre/${id}`, { method: 'POST', headers: ADMIN, body: JSON.stringify(body) });
const vote = (m, player, cookie) => post(`/api/matches/${m.slug}/motm`, { player }, cookie);

test('voting: before kick-off rejected, live accepted once, second vote rejected, after full time rejected', async () => {
  const m = await homeMatch();
  const a = await fan(), b = await fan();

  const early = await vote(m, roster[0].slug, a);
  assert.equal(early.status, 409);
  assert.equal(early.data.code, 'before');

  await control(m.id, { action: 'kickoff' });
  const ok = await vote(m, roster[0].slug, a);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.myVote.name, roster[0].name);

  const again = await vote(m, roster[1].slug, a);
  assert.equal(again.status, 409);
  assert.equal(again.data.code, 'voted');
  assert.match(again.data.error, new RegExp(roster[0].name));

  const mine = await get(`/api/matches/${m.slug}/motm`, a);
  assert.equal(mine.data.myVote.slug, roster[0].slug, 'vote cannot be changed');

  await control(m.id, { action: 'fulltime', home_score: 1, away_score: 0 });
  const late = await vote(m, roster[0].slug, b);
  assert.equal(late.status, 409);
  assert.equal(late.data.code, 'closed');
});

test('only logged-in, verified fans can vote, and only for squad players', async () => {
  const m = await homeMatch();
  await control(m.id, { action: 'kickoff' });
  const anon = await vote(m, roster[0].slug);
  assert.equal(anon.status, 401);
  assert.equal(await fan({ verify: false }), null);
  const c = await fan();
  const notInSquad = roster[3] ? await vote(m, roster[3].slug, c) : await vote(m, 'not-a-player', c);
  assert.equal(notInSquad.status, 400);
  await control(m.id, { action: 'fulltime', home_score: 0, away_score: 0 });
});

test('leaderboard is hidden while live and revealed at full time, with joint winners on a tie', async () => {
  const m = await homeMatch();
  await control(m.id, { action: 'kickoff' });
  const fans = await Promise.all([fan(), fan(), fan(), fan()]);
  // 2 votes each for players 0 and 1 -> joint winners; player 2 none.
  await vote(m, roster[0].slug, fans[0]); await vote(m, roster[0].slug, fans[1]);
  await vote(m, roster[1].slug, fans[2]); await vote(m, roster[1].slug, fans[3]);

  const live = await get(`/api/matches/${m.slug}/motm`);
  assert.equal(live.data.state, 'open');
  assert.equal(live.data.results, null, 'no counts or rankings during the match');
  assert.equal(live.data.totalVoters, 4, 'only the number of voters');

  await control(m.id, { action: 'fulltime', home_score: 2, away_score: 2 });
  const ft = await get(`/api/matches/${m.slug}/motm`);
  assert.equal(ft.data.state, 'closed');
  assert.equal(ft.data.results.total, 4);
  assert.deepEqual([...ft.data.results.winners].sort(), [roster[0].slug, roster[1].slug].sort());
  const r2 = ft.data.results.rows.find(r => r.slug === roster[2].slug);
  assert.equal(r2.votes, 0);
  assert.equal(ft.data.results.rows.find(r => r.slug === roster[0].slug).pct, 50);

  const awards = await get('/api/motm/awards');
  assert.ok(awards.data.awards[roster[0].slug] >= 1, 'award counted on the player profile');

  const csv = await fetch(`${BASE}/api/admin/motm/${m.id}?format=csv`, { headers: ADMIN });
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /Rank,Player,Shirt Number,Position,Votes,% of votes,Man of the Match/);
});

test('away games have no voting', async () => {
  const m = await homeMatch({ home_team: 'Sokoto United FC', away_team: 'Lobi Stars FC' });
  assert.equal((await get(`/api/matches/${m.slug}/motm`)).status, 404);
  assert.equal((await vote(m, roster[0].slug, await fan())).status, 404);
});
