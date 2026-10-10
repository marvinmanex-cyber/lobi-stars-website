// Phase 4: fixture card buttons, Matches menu and the /stats page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seasonOf, parsePlayerStats } from '../functions/api/_lib/stats.js';
import { isMatchDay } from '../functions/api/_lib/matchCentre.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const H = 3600e3;

test('seasons run from August (configurable)', () => {
  assert.equal(seasonOf('2026-08-01T10:00:00Z'), '2026/27');
  assert.equal(seasonOf('2027-05-20T10:00:00Z'), '2026/27');
  assert.equal(seasonOf('2026-07-31T10:00:00Z'), '2025/26');
  assert.equal(seasonOf('2026-09-01T10:00:00Z', 10), '2025/26');
});

test('player stats are validated against the squad and empty rows dropped', () => {
  const roster = [{ slug: 'a' }, { slug: 'b' }];
  const rows = parsePlayerStats([
    { player: 'a', started: true, goals: 2, yellow: 5 }, { player: 'b' }, { player: 'nobody', goals: 3 },
  ], roster);
  assert.deepEqual(rows, [{ player: 'a', played: 1, started: 1, goals: 2, assists: 0, yellow: 2, red: 0 }]);
});

test('Matchday Live buttons only around match day', () => {
  const ko = Date.parse('2026-10-23T15:30:00Z');
  const m = { status: 'scheduled', event_date: new Date(ko).toISOString() };
  assert.equal(isMatchDay(m, ko - 25 * H), false);
  assert.equal(isMatchDay(m, ko - 23 * H), true);
  assert.equal(isMatchDay(m, ko + 5 * H), true, 'same evening');
  assert.equal(isMatchDay(m, ko + 30 * H), false);
  assert.equal(isMatchDay({ ...m, status: 'live' }, ko + 30 * H), true);
});

test('Buy Tickets only for priced upcoming home games; on_sale flag in the API', async () => {
  const mk = async over => {
    const { id } = await fetch(`${BASE}/api/admin/events`, { method: 'POST', headers: ADMIN, body: JSON.stringify({
      home_team: 'Lobi Stars FC', away_team: `Stats Test ${Math.random().toString(36).slice(2, 7)}`, competition: 'NNL Conference D', venue: 'McCarthy Stadium, Makurdi',
      event_date: new Date(Date.now() + 72 * H).toISOString(), vip_price_kobo: 0, premium_price_kobo: 0, regular_price_kobo: 0, active: true, ...over,
    }) }).then(r => r.json());
    return id;
  };
  const free = await mk({}), priced = await mk({ regular_price_kobo: 200000 });
  const { matches } = await fetch(`${BASE}/api/matches`).then(r => r.json());
  assert.equal(matches.find(m => m.id === free).on_sale, false);
  assert.equal(matches.find(m => m.id === priced).on_sale, true);
  const fx = await fetch(`${BASE}/fixtures/`).then(r => r.text());
  assert.ok(fx.includes(`/tickets?event=${priced}`), 'priced game has Buy Tickets');
  assert.ok(!fx.includes(`/tickets?event=${free}`), 'unpriced game has no Buy Tickets');
});

test('Matches sub-menu on match pages and /matchday redirect', async () => {
  for (const path of ['/fixtures/', '/results/', '/table/', '/stats/', '/watch/', '/commentary/', '/man-of-the-match/', '/predict-and-win/']) {
    const html = await fetch(BASE + path).then(r => r.text());
    for (const label of ['Fixtures', 'Results', 'Table', 'Stats', 'Matchday Live', 'Watch Live', 'Commentary', 'Man of the Match', 'Predict &amp; Win']) {
      assert.ok(html.includes(`>${label}</a>`), `${path} has ${label}`);
    }
  }
  const r = await fetch(`${BASE}/matchday`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /\/matches\/.+\/live\/$|\/fixtures\/$/);
});

test('admin saves player stats; /stats shows the team record from results', async () => {
  const roster = await fetch(`${BASE}/data/players.json`).then(r => r.json());
  const { id } = await fetch(`${BASE}/api/admin/events`, { method: 'POST', headers: ADMIN, body: JSON.stringify({
    home_team: 'Lobi Stars FC', away_team: `Stats FT ${Math.random().toString(36).slice(2, 7)}`, competition: 'NNL Conference D', venue: 'McCarthy Stadium, Makurdi',
    event_date: new Date(Date.now() - 3 * H).toISOString(), vip_price_kobo: 0, premium_price_kobo: 0, regular_price_kobo: 0, active: true,
  }) }).then(r => r.json());
  const put = await fetch(`${BASE}/api/admin/match-centre/${id}`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({
    status: 'full-time', home_score: 2, away_score: 0, playerStats: [{ player: roster[0].slug, started: true, goals: 1 }],
  }) });
  assert.equal(put.status, 200);
  const { match } = await fetch(`${BASE}/api/admin/match-centre/${id}`, { headers: ADMIN }).then(r => r.json());
  assert.deepEqual(match.playerStats.map(r => [r.player, r.played, r.goals]), [[roster[0].slug, true, 1]]);
  const html = await fetch(`${BASE}/stats/`).then(r => r.text());
  assert.match(html, /<span>Played<\/span>/);
  assert.match(html, /Longest unbeaten run/);
  assert.doesNotMatch(html, /Sample (Goalkeeper|Defender|Forward)/, 'sample players never on the public leaderboards');
});
