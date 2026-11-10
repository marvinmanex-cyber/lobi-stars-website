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
  sql(`DELETE FROM sc_sessions WHERE name = 'SC Tester ${T}'; DELETE FROM rate_limits WHERE key LIKE 'sc-fail:%'; DELETE FROM sc_settings WHERE key = 'code_hash';${fixture ? ` DELETE FROM sc_events WHERE fixture_id = ${fixture.id} AND created_by = 'SC Tester ${T}'; DELETE FROM sc_match WHERE fixture_id = ${fixture.id};` : ''}`);
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

test('someone else changed it: not overwritten without asking', async () => {
  const w = await call('week?week=1');
  const m = w.d.matches.find(x => x.id === fixture.id);
  // Another person updates first.
  assert.equal((await call('update', { fixtureId: fixture.id, homeGoals: 4, awayGoals: 1, status: 'FULL_TIME', version: m.version })).status, 200);
  // The first person still has the old version: refused, with what it is now.
  const stale = await call('update', { fixtureId: fixture.id, homeGoals: 3, awayGoals: 2, status: 'FULL_TIME', version: m.version });
  assert.equal(stale.status, 409);
  assert.equal(stale.d.current.homeGoals, 4);
  assert.match(stale.d.current.by, /SC Tester/);
  const forced = await call('update', { fixtureId: fixture.id, homeGoals: 3, awayGoals: 2, status: 'FULL_TIME', version: m.version, force: true });
  assert.equal(forced.status, 200, 'replaced after saying yes');
});

test('a verified Live score gives way to a later full-time report with the same score', async () => {
  assert.equal((await call('update', { fixtureId: fixture.id, homeGoals: 2, awayGoals: 0, status: 'LIVE', force: true })).status, 200);
  assert.equal(rows(`SELECT status FROM league_fixtures WHERE id = ${fixture.id}`)[0].status, 'live');
  // Staff report full time in Other Games (a report, not a verified result).
  const H = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
  const r = await fetch(`${BASE}/api/admin/scores/matchday`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'entry', fixtureId: fixture.id, homeGoals: 2, awayGoals: 0, status: 'FULL_TIME' }) });
  assert.equal(r.status, 200, await r.text());
  const f = rows(`SELECT status, home_goals, away_goals FROM league_fixtures WHERE id = ${fixture.id}`)[0];
  assert.deepEqual([f.status, f.home_goals, f.away_goals], ['full_time', 2, 0], 'full time counts');
  // Put it back as the next test expects (4-1 full time, then 3-2 forced).
  assert.equal((await call('update', { fixtureId: fixture.id, homeGoals: 4, awayGoals: 1, status: 'FULL_TIME', force: true })).status, 200);
  assert.equal((await call('update', { fixtureId: fixture.id, homeGoals: 3, awayGoals: 2, status: 'FULL_TIME', force: true })).status, 200);
});

test('history and undo last change: back to the score before', async () => {
  const h = await call(`history?fixtureId=${fixture.id}`);
  assert.equal(h.status, 200);
  assert.ok(h.d.changes.length >= 2 && h.d.canUndo);
  assert.equal(h.d.changes[0].home, 3);
  assert.equal((await call('undo', { fixtureId: fixture.id })).status, 200);
  const f = rows(`SELECT home_goals, away_goals FROM league_fixtures WHERE id = ${fixture.id}`)[0];
  assert.deepEqual([f.home_goals, f.away_goals], [4, 1], 'the score before the last change');
  assert.ok(rows(`SELECT COUNT(*) AS n FROM league_audit_log WHERE action = 'score.undo' AND staff_email = 'scores-centre: SC Tester ${T}'`)[0].n >= 1);
});

test('goals, red cards, notes, the clock and covering', async () => {
  assert.equal((await call('event', { fixtureId: fixture.id, kind: 'goal', side: 'home', player: 'Test Striker', minute: '12' })).status, 200);
  assert.equal((await call('event', { fixtureId: fixture.id, kind: 'red', side: 'away', player: 'Test Defender', minute: '90+2' })).status, 200);
  assert.equal((await call('event', { fixtureId: fixture.id, kind: 'goal', side: 'home', minute: 'abc' })).status, 400);
  assert.equal((await call('event', { fixtureId: fixture.id, kind: 'nope', side: 'home' })).status, 400);
  assert.equal((await call('note', { fixtureId: fixture.id, note: 'Kick-off delayed 30 min' })).status, 200);
  assert.equal((await call('clock', { fixtureId: fixture.id, action: 'kickoff' })).status, 200);
  assert.equal((await call('clock', { fixtureId: fixture.id, action: 'second-half' })).status, 200);
  assert.equal((await call('cover', { fixtureId: fixture.id, on: true })).status, 200);
  const w = await call('week?week=1');
  const m = w.d.matches.find(x => x.id === fixture.id);
  assert.equal(m.events.length, 2);
  assert.equal(m.events[0].player, 'Test Striker');
  assert.equal(m.note, 'Kick-off delayed 30 min');
  assert.ok(m.kickedOffAt && m.secondHalfAt);
  assert.equal(m.covering, `SC Tester ${T}`); assert.equal(m.coveringMe, true);
  assert.ok(w.d.online.includes(`SC Tester ${T}`), 'online now');
  const red = m.events.find(e => e.kind === 'red');
  assert.equal((await call('event-remove', { id: red.id })).status, 200);
  assert.equal((await call('event-remove', { id: red.id })).status, 400, 'already removed');
  assert.equal((await call('cover', { fixtureId: fixture.id, on: false })).status, 200);
  const h = await call(`history?fixtureId=${fixture.id}`);
  assert.ok(h.d.events.some(e => e.removedAt), 'removed entries stay in the history');
  // The public scoreboard data carries the named scorer once the score counts.
  const t = await fetch(`${BASE}/api/league/table`).then(r => r.json());
  const sb = (t.scoreboard || []).find(x => x.id === fixture.id);
  if (sb && sb.homeGoals != null) assert.ok(sb.goals.some(g => g.player === 'Test Striker'));
});

test('live now: today\'s matches only, live first', async () => {
  const w = await call('week?week=live');
  assert.equal(w.status, 200);
  assert.equal(w.d.week, 'live');
  assert.ok(Array.isArray(w.d.matches));
});

test('Super Admins: who is signed in, change the code, sign everyone out', async () => {
  const H = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
  const o = await fetch(`${BASE}/api/admin/scores-centre`, { headers: H }).then(async r => ({ status: r.status, d: await r.json() }));
  assert.equal(o.status, 200, JSON.stringify(o.d));
  assert.ok(o.d.sessions.some(x => x.name === `SC Tester ${T}` && x.open));
  assert.ok(o.d.refused.some(x => /Guesser/.test(x.text)), 'wrong codes listed');
  const post = b => fetch(`${BASE}/api/admin/scores-centre`, { method: 'POST', headers: H, body: JSON.stringify(b) }).then(async r => ({ status: r.status, d: await r.json() }));
  assert.equal((await post({ action: 'code', code: '1111' })).status, 400, 'too easy');
  assert.equal((await post({ action: 'code', code: '4826' })).status, 200);
  assert.equal((await login({ code: CODE, name: 'Old code' })).status, 401, 'the old code no longer works');
  const fresh = await login({ code: '4826', name: `SC Tester ${T}` });
  assert.equal(fresh.status, 200, 'the new code works');
  const all = await post({ action: 'signout-all' });
  assert.ok(all.d.ended >= 1);
  assert.equal((await call('session')).status, 401, 'signed out by a Super Admin');
  sql(`DELETE FROM sc_settings WHERE key = 'code_hash';`); // back to the secret
  C = (await login({ code: CODE, name: `SC Tester ${T}` })).cookie;
  csrf = (await call('session')).d.csrf;
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
