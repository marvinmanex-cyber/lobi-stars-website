// Matchday Live page tests (Phase 3). Needs the local Pages dev server
// with ADMIN_CODE=test-code-123 (see tests/fans.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };

async function createMatch(over = {}) {
  const res = await fetch(`${BASE}/api/admin/events`, {
    method: 'POST', headers: ADMIN, body: JSON.stringify({
      home_team: 'Lobi Stars FC', away_team: `Live Test ${Date.now() % 100000}`, competition: 'NNL Conference D',
      venue: 'McCarthy Stadium, Makurdi', event_date: new Date(Date.now() + 2 * 864e5).toISOString(),
      vip_price_kobo: 0, premium_price_kobo: 0, regular_price_kobo: 0, active: true, ...over,
    }),
  });
  const { id } = await res.json();
  const m = await fetch(`${BASE}/api/admin/match-centre/${id}`, { headers: ADMIN }).then(r => r.json());
  return m.match;
}

test('home game: /matches/<slug>/live serves Matchday Live with its own title', async () => {
  const m = await createMatch();
  const res = await fetch(`${BASE}/matches/${m.slug}/live/`, { redirect: 'manual' });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<title>Lobi Stars FC vs .* \| Matchday Live \| Lobi Stars FC<\/title>/);
  assert.doesNotMatch(html, /name="robots" content="noindex/);
  assert.match(html, new RegExp(`/matches/${m.slug}/live/`));
});

test('away game: Matchday Live redirects to the normal Match Centre', async () => {
  const m = await createMatch({ home_team: 'Sokoto United FC', away_team: 'Lobi Stars FC' });
  const res = await fetch(`${BASE}/matches/${m.slug}/live/`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), new RegExp(`/matches/${m.slug}/$`));
});

test('unknown match returns 404', async () => {
  const res = await fetch(`${BASE}/matches/no-such-match/live/`, { redirect: 'manual' });
  assert.equal(res.status, 404);
});

test('match API returns server time for countdowns and the home flag', async () => {
  const m = await createMatch();
  const data = await fetch(`${BASE}/api/matches/${m.slug}`).then(r => r.json());
  assert.ok(Math.abs(new Date(data.serverTime).getTime() - Date.now()) < 60_000);
  assert.equal(data.match.is_home, true);
});

test('a live home game is flagged live in /api/matches (drives the homepage banner)', async () => {
  const m = await createMatch();
  await fetch(`${BASE}/api/admin/match-centre/${m.id}`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ action: 'kickoff' }) });
  const { matches } = await fetch(`${BASE}/api/matches`).then(r => r.json());
  const row = matches.find(x => x.id === m.id);
  assert.equal(row.status, 'live');
  assert.equal(row.is_home, true);
  await fetch(`${BASE}/api/admin/match-centre/${m.id}`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ action: 'fulltime', home_score: 1, away_score: 0 }) });
});
