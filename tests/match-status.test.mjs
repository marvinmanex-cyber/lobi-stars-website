// Match status control tests (Phase 2). Needs the local Pages dev server
// with ADMIN_CODE=test-code-123 (see tests/fans.test.mjs for how to start it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };

async function api(path, method = 'GET', body) {
  const res = await fetch(BASE + path, { method, headers: ADMIN, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

/** Runs SQL against the LOCAL D1 database used by `wrangler pages dev`. */
function localSql(sql) {
  execSync(`npx wrangler d1 execute lobi-stars-tickets --local --command "${sql.replace(/"/g, '\\"')}"`, { stdio: 'pipe' });
}

async function createMatch(over = {}) {
  const r = await api('/api/admin/events', 'POST', {
    home_team: 'Lobi Stars FC', away_team: `Test Opponent ${Date.now() % 100000}`, competition: 'NNL Conference D',
    venue: 'McCarthy Stadium, Makurdi', event_date: new Date(Date.now() + 3 * 864e5).toISOString(),
    vip_price_kobo: 0, premium_price_kobo: 0, regular_price_kobo: 0, active: true, ...over,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.id;
}

test('home game: kick-off -> live (server time) -> full-time with score', async () => {
  const id = await createMatch();
  const early = await api(`/api/admin/match-centre/${id}`, 'POST', { action: 'fulltime', home_score: 1, away_score: 0 });
  assert.equal(early.status, 409, 'cannot end a match that never kicked off');

  const before = Date.now();
  const k = await api(`/api/admin/match-centre/${id}`, 'POST', { action: 'kickoff' });
  assert.equal(k.status, 200, JSON.stringify(k.data));
  assert.equal(k.data.status, 'live');
  assert.ok(Math.abs(new Date(k.data.kickoff_at).getTime() - before) < 60_000, 'kick-off time comes from the server clock');
  assert.equal((await api(`/api/admin/match-centre/${id}`, 'POST', { action: 'kickoff' })).status, 409, 'no double kick-off');

  const live = await api(`/api/admin/match-centre/${id}`);
  assert.equal(live.data.match.status, 'live');
  assert.equal(live.data.match.is_home, true);

  assert.equal((await api(`/api/admin/match-centre/${id}`, 'POST', { action: 'fulltime' })).status, 400, 'score required');
  const ft = await api(`/api/admin/match-centre/${id}`, 'POST', { action: 'fulltime', home_score: 2, away_score: 1 });
  assert.equal(ft.status, 200);
  const after = await api(`/api/admin/match-centre/${id}`);
  assert.equal(after.data.match.status, 'full-time');
  assert.equal(after.data.match.home_score, 2);
  assert.ok(after.data.match.ended_at);
  assert.equal((await api(`/api/admin/match-centre/${id}`, 'POST', { action: 'kickoff' })).status, 409, 'cannot restart a finished match');
});

test('away game: kick-off control is refused', async () => {
  const id = await createMatch({ home_team: 'Wikki Tourists FC', away_team: 'Lobi Stars FC' });
  const r = await api(`/api/admin/match-centre/${id}`, 'POST', { action: 'kickoff' });
  assert.equal(r.status, 400);
  assert.equal((await api(`/api/admin/match-centre/${id}`)).data.match.is_home, false);
});

test('is_home can be set explicitly by staff', async () => {
  const id = await createMatch({ is_home: false });
  assert.equal((await api(`/api/admin/match-centre/${id}`)).data.match.is_home, false);
});

test('a match left live closes automatically 2h15 after kick-off', async () => {
  const id = await createMatch();
  await api(`/api/admin/match-centre/${id}`, 'POST', { action: 'kickoff' });
  const kickoff = new Date(Date.now() - (2 * 60 + 16) * 60_000).toISOString();
  localSql(`UPDATE match_centre SET kickoff_at = '${kickoff}' WHERE event_id = '${id}'`);

  const list = await fetch(`${BASE}/api/matches`).then(r => r.json());
  const m = list.matches.find(x => x.id === id);
  assert.equal(m.status, 'full-time');
  const detail = await api(`/api/admin/match-centre/${id}`);
  assert.equal(detail.data.match.auto_closed, true);
  assert.equal(new Date(detail.data.match.ended_at).getTime(), new Date(kickoff).getTime() + 135 * 60_000);
  assert.equal(detail.data.match.home_score, null);

  // Staff can still add the final score afterwards; the end time is kept.
  const ft = await api(`/api/admin/match-centre/${id}`, 'POST', { action: 'fulltime', home_score: 0, away_score: 0 });
  assert.equal(ft.status, 200);
  assert.equal(new Date(ft.data.ended_at).getTime(), new Date(kickoff).getTime() + 135 * 60_000);
});

test('a match still within 2h15 stays live', async () => {
  const id = await createMatch();
  await api(`/api/admin/match-centre/${id}`, 'POST', { action: 'kickoff' });
  localSql(`UPDATE match_centre SET kickoff_at = '${new Date(Date.now() - 100 * 60_000).toISOString()}' WHERE event_id = '${id}'`);
  assert.equal((await api(`/api/admin/match-centre/${id}`)).data.match.status, 'live');
});

test('matchday squad keeps only real players and stores a snapshot', async () => {
  const roster = await fetch(`${BASE}/data/players.json`).then(r => r.json());
  assert.ok(roster.length >= 2, 'needs players in the content collection');
  const id = await createMatch();
  const current = (await api(`/api/admin/match-centre/${id}`)).data.match;
  const r = await api(`/api/admin/match-centre/${id}`, 'PUT', {
    ...current, squad: { starting: [roster[0].slug, 'not-a-player'], bench: [roster[1].slug, roster[0].slug] },
  });
  assert.equal(r.status, 200);
  const squad = (await api(`/api/admin/match-centre/${id}`)).data.match.squad;
  assert.deepEqual(squad.starting.map(p => p.slug), [roster[0].slug]);
  assert.deepEqual(squad.bench.map(p => p.slug), [roster[1].slug], 'a player cannot be both starting and on the bench');
  assert.equal(squad.starting[0].name, roster[0].name);
});
