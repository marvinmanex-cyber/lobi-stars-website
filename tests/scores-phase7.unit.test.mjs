// Score verification, Phase 7, without a server: the table rules (points
// deduction, tie-breakers, postponed / abandoned / awarded, only confirmed
// results count), the daily matchday summary and the Website Health checks.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { d1 } from './helpers/d1shim.mjs';
import { computeStandings } from '../functions/api/_lib/league/standings.js';
import { ensureConsensusSchema, settleFixture } from '../functions/api/_lib/scores/consensus.js';
import { ensureScoreSchema, addReport } from '../functions/api/_lib/scores/model.js';
import { matchdaySummary, maybeDailySummary, scoreHealth } from '../functions/api/_lib/scores/summary.js';

const T = [1, 2, 3, 4].map(id => ({ id, name: `Team ${id}`, short_name: `T${id}` }));
const RULES = { points_win: 3, points_draw: 1, points_loss: 0, tiebreak_order: JSON.stringify(['points', 'goal_difference', 'goals_for', 'h2h_points']) };
const fx = (id, h, a, hg, ag, status = 'full_time', extra = {}) => ({ id, matchday: 1, home_team_id: h, away_team_id: a, home_goals: hg, away_goals: ag, status, ...extra });
const pos = (rows, id) => rows.find(r => r.team.id === id).pos;
const pts = (rows, id) => rows.find(r => r.team.id === id).points;

test('only confirmed, verified or official results count', () => {
  const t = computeStandings({ teams: T, rules: RULES, fixtures: [fx(1, 1, 2, 2, 0, 'full_time', { verification: 'CONFIRMED' }), fx(2, 3, 4, 5, 0, 'full_time', { verification: 'UNCONFIRMED' }), fx(3, 3, 4, 1, 0, 'full_time', { verification: 'CONFLICT' })] });
  assert.equal(pts(t.rows, 1), 3);
  assert.equal(pts(t.rows, 3), 0, 'one source / conflict: not counted');
});

test('postponed and cancelled don\'t count, abandoned doesn\'t count until decided, awarded counts', () => {
  const t = computeStandings({ teams: T, rules: RULES, fixtures: [fx(1, 1, 2, null, null, 'postponed'), fx(2, 3, 4, 1, 0, 'abandoned'), fx(3, 1, 3, null, null, 'cancelled'), fx(4, 2, 4, 3, 0, 'awarded', { result_type: 'awarded', verification: 'OFFICIAL' })] });
  assert.equal(t.rows.find(r => r.team.id === 3).played, 0, 'abandoned: not counted');
  assert.equal(t.rows.find(r => r.team.id === 1).played, 0, 'postponed / cancelled: not counted');
  assert.equal(pts(t.rows, 2), 3, 'awarded: counted');
});

test('a points deduction changes the points and the position', () => {
  const fixtures = [fx(1, 1, 2, 1, 0), fx(2, 3, 4, 1, 0)];
  const before = computeStandings({ teams: T, rules: RULES, fixtures });
  const after = computeStandings({ teams: T, rules: RULES, fixtures, adjustments: [{ team_id: 1, points_delta: -3, is_active: 1 }] });
  assert.equal(pts(after.rows, 1), 0);
  assert.ok(pos(after.rows, 1) > pos(before.rows, 1), 'drops down');
  assert.equal(after.rows.find(r => r.team.id === 1).adjustment, -3);
});

test('tie-breakers follow the order set in Table & Rules', () => {
  // Teams 1 and 3 both have 3 points; team 3 has the better goal difference.
  const fixtures = [fx(1, 1, 2, 1, 0), fx(2, 3, 4, 4, 0)];
  const gd = computeStandings({ teams: T, rules: RULES, fixtures });
  assert.ok(pos(gd.rows, 3) < pos(gd.rows, 1), 'goal difference first');
  const wins = computeStandings({ teams: T, rules: { ...RULES, tiebreak_order: JSON.stringify(['points', 'goals_against', 'goal_difference']) }, fixtures: [fx(1, 1, 2, 1, 0), fx(2, 3, 4, 4, 1)] });
  assert.ok(pos(wins.rows, 1) < pos(wins.rows, 3), 'goals against first when the rules say so');
});

// ── Daily summary and health, on an in-memory database ──
const DB = d1();
const env = { DB };
let FX = [];
const NOW = Date.parse('2026-11-08T17:00:00Z');
before(async () => {
  await ensureScoreSchema(env);
  await ensureConsensusSchema(env);
  FX = (await DB.prepare(`SELECT f.id, h.short_name AS home, a.short_name AS away FROM league_fixtures f JOIN league_teams h ON h.id = f.home_team_id JOIN league_teams a ON a.id = f.away_team_id WHERE h.is_lobi = 0 AND a.is_lobi = 0 ORDER BY f.id LIMIT 2`).all()).results;
  await DB.prepare(`UPDATE league_fixtures SET kickoff_at = '2027-05-01T15:00:00Z'`).run();
  for (const f of FX) await DB.prepare(`UPDATE league_fixtures SET kickoff_at = '2026-11-08T15:00:00Z' WHERE id = ?`).bind(f.id).run();
});

test('daily matchday summary: waits while a match is open, then sends once with every result', async () => {
  const at = new Date(NOW - 60 * 60e3).toISOString();
  for (const [type, id] of [['STAFF_MANUAL', 'staff:1'], ['CLUB_NETWORK', 'submitter:1']]) await addReport(env, { sourceType: type, identity: id, label: id, fixtureId: FX[0].id, homeGoals: 2, awayGoals: 0, status: 'FULL_TIME', receivedAt: at });
  await addReport(env, { sourceType: 'STAFF_MANUAL', identity: 'staff:1', label: 'staff', fixtureId: FX[1].id, homeGoals: 1, awayGoals: 1, status: 'FULL_TIME', receivedAt: at });
  const sum = await matchdaySummary(env, { now: NOW });
  assert.equal(sum.matches.length, 2);
  assert.equal(sum.done, false, 'one match has only one source');
  assert.equal(await maybeDailySummary(env, { now: NOW }), null, 'not yet: 4 hours after the last kick-off at the latest');
  const r = await maybeDailySummary(env, { now: NOW + 3 * 3600e3 });
  assert.equal(r.open, 1, 'sent, saying one match is still open');
  assert.ok(await DB.prepare(`SELECT 1 FROM score_alerts WHERE key = 'summary:2026-11-08'`).first(), 'recorded once');
  assert.equal((await maybeDailySummary(env, { now: NOW + 4 * 3600e3 })).sent, false, 'not sent twice');
});

test('Website Health: the score check, automatic sources and the backlog', async () => {
  const result = (id, status, extra) => ({ id, status, ...extra });
  let h = await scoreHealth(env, result, NOW);
  assert.equal(h.find(x => x.id === 'scores_run').status, 'WARNING', 'never ran');
  await DB.prepare(`INSERT INTO score_settings (key, value) VALUES ('_last_tick', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(new Date(NOW - 60e3).toISOString()).run();
  await DB.prepare(`UPDATE score_sources SET enabled = 1, last_checked_at = ?, last_error = 'API answered 401' WHERE type = 'LICENSED_API'`).bind(new Date(NOW).toISOString()).run();
  await DB.prepare(`INSERT INTO score_state (fixture_id, state, conflict_since, updated_at) VALUES (999, 'CONFLICT', ?, ?)`).bind(new Date(NOW - 3600e3).toISOString(), new Date(NOW).toISOString()).run();
  h = await scoreHealth(env, result, NOW);
  assert.equal(h.find(x => x.id === 'scores_run').status, 'PASS');
  assert.equal(h.find(x => x.id === 'score_sources').status, 'FAIL');
  assert.match(h.find(x => x.id === 'score_sources').problem, /401/);
  assert.equal(h.find(x => x.id === 'score_backlog').status, 'WARNING');
  assert.equal((await scoreHealth(env, result, NOW + 20 * 60e3)).find(x => x.id === 'scores_run').status, 'FAIL', 'stopped for 20 minutes');
  assert.ok(await settleFixture(env, FX[0].id, { now: NOW }));
});
