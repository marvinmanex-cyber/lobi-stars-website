// Scores Update Centre against a running server (local server uses SCORES_CENTRE_CODE=1234):
// sign-in with the code and a name, wrong-code limits, a week's matches, updating a score (the table
// changes), only the newest centre update stays active, Clear, and changes need the page's token.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './media-helpers.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const CODE = process.env.SC_CODE || '1234';
const T = Date.now().toString(36).toUpperCase();
const rows = q => JSON.parse(sql(q))[0].results;
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const login = (body, from = ip()) => fetch(`${BASE}/api/scores-centre/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': from }, body: JSON.stringify(body) })
  .then(async r => ({ status: r.status, d: await r.json().catch(() => ({})), cookie: ((r.headers.get('set-cookie') || '').match(/ls_sc=([^;]+)/) || [])[1] }));
let C, csrf, fixture, before;
const call = (path, body, token = csrf) => fetch(`${BASE}/api/scores-centre/${path}`, body ? { method: 'POST', headers: { Cookie: `ls_sc=${C}`, 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify(body) } : { headers: { Cookie: `ls_sc=${C}` } })
  .then(async r => ({ status: r.status, d: await r.json().catch(() => ({})) }));

after(() => {
  if (fixture) sql(`DELETE FROM score_decisions WHERE fixture_id = ${fixture.id} AND created_by LIKE 'SC Tester ${T}%'; UPDATE league_fixtures SET home_goals = ${before.home_goals ?? 'NULL'}, away_goals = ${before.away_goals ?? 'NULL'}, status = '${before.status}', verification = ${before.verification ? `'${before.verification}'` : 'NULL'} WHERE id = ${fixture.id};`);
  sql(`DELETE FROM sc_sessions WHERE name = 'SC Tester ${T}'; DELETE FROM rate_limits WHERE key LIKE 'sc-fail:%';`);
});

test('sign-in: name and code needed; wrong codes are limited per connection', async () => {
  sql(`DELETE FROM rate_limits WHERE key LIKE 'sc-fail:%';`);
  assert.equal((await login({ code: CODE, name: '' })).status, 400, 'a name is needed');
  const from = ip();
  for (let i = 0; i < 5; i++) assert.equal((await login({ code: '0000', name: 'Guesser' }, from)).status, 401);
  assert.equal((await login({ code: CODE, name: 'Guesser' }, from)).status, 429, 'blocked after 5 wrong codes, even with the right one');
  const ok = await login({ code: CODE, name: `SC Tester ${T}` });
  assert.equal(ok.status, 200, JSON.stringify(ok.d));
  assert.ok(ok.cookie);
  C = ok.cookie;
  const s = await call('session');
  assert.equal(s.d.name, `SC Tester ${T}`);
  assert.equal(s.d.idleMinutes, 120, 'signed in until 2 hours without activity');
  csrf = s.d.csrf;
  assert.equal((await fetch(`${BASE}/api/scores-centre/week`)).status, 401, 'nothing without signing in');
});

test('a week: its matches, the weeks list and the table', async () => {
  const w = await call('week?week=1');
  assert.equal(w.status, 200, JSON.stringify(w.d));
  assert.equal(w.d.week, 1);
  assert.ok(w.d.weeks.length >= 1 && w.d.matches.length >= 1);
  assert.ok(w.d.table && w.d.table.rows.length >= 2);
  fixture = w.d.matches[0];
  before = rows(`SELECT home_goals, away_goals, status, verification FROM league_fixtures WHERE id = ${fixture.id}`)[0];
});

test('update: the score counts in the table at once; the newest update wins; changes need the token', async () => {
  assert.equal((await call('update', { fixtureId: fixture.id, homeGoals: 2, awayGoals: 1, status: 'FULL_TIME' }, 'wrong')).status, 403);
  assert.equal((await call('update', { fixtureId: fixture.id, homeGoals: 2, awayGoals: 1, status: 'NOPE' })).status, 400);
  const r1 = await call('update', { fixtureId: fixture.id, homeGoals: 1, awayGoals: 0, status: 'LIVE' });
  assert.equal(r1.status, 200, JSON.stringify(r1.d));
  const r2 = await call('update', { fixtureId: fixture.id, homeGoals: 3, awayGoals: 1, status: 'FULL_TIME' });
  assert.equal(r2.status, 200, JSON.stringify(r2.d));
  const f = rows(`SELECT home_goals, away_goals, status, verification FROM league_fixtures WHERE id = ${fixture.id}`)[0];
  assert.deepEqual([f.home_goals, f.away_goals, f.status, f.verification], [3, 1, 'full_time', 'VERIFIED']);
  const active = rows(`SELECT COUNT(*) AS n FROM score_decisions WHERE fixture_id = ${fixture.id} AND active = 1 AND created_by LIKE 'SC Tester ${T}%'`)[0].n;
  assert.equal(active, 1, 'only the newest centre update stays active');
  const w = await call('week?week=1');
  const m = w.d.matches.find(x => x.id === fixture.id);
  assert.deepEqual([m.homeGoals, m.awayGoals, m.status, m.counted, m.updatedBy], [3, 1, 'FULL_TIME', true, `SC Tester ${T}`]);
  const home = w.d.table.rows.find(r => r.name === fixture.home.name);
  assert.ok(home.p >= 1 && home.w >= 1, 'the table counts the result');
  assert.ok(w.d.recent.some(x => x.text.includes(`SC Tester ${T}`)), 'recent updates list who did it');
  assert.ok(rows(`SELECT COUNT(*) AS n FROM league_audit_log WHERE staff_email = 'scores-centre: SC Tester ${T}' AND action = 'score.verified'`)[0].n >= 2, 'in League History');
});

test('clear: withdraws the centre score; signing out ends the session', async () => {
  const c = await call('clear', { fixtureId: fixture.id });
  assert.equal(c.status, 200, JSON.stringify(c.d));
  assert.equal(rows(`SELECT COUNT(*) AS n FROM score_decisions WHERE fixture_id = ${fixture.id} AND active = 1 AND created_by LIKE 'SC Tester ${T}%'`)[0].n, 0);
  assert.equal((await call('clear', { fixtureId: fixture.id })).status, 400, 'nothing left to clear');
  assert.equal((await call('logout', {})).status, 200);
  assert.equal((await call('session')).status, 401);
});

test('the page: not indexed', async () => {
  const html = await fetch(`${BASE}/scores-centre/`).then(r => r.text());
  assert.match(html, /noindex/);
  assert.match(html, /Scores Update Centre/);
});
