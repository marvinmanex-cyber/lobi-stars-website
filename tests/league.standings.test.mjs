// League table calculation, hand-checked cases (no server needed):
// node --test tests/league.standings.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStandings, isCounted, buildFormGuide, explainPosition, tiebreakInWords, nextFixture, groupByMatchday } from '../functions/api/_lib/league/standings.js';
import { buildIcs, foldLine } from '../functions/api/_lib/league/ics.js';
import { validateResultInput, validateRules, validateFixtureInput } from '../functions/api/_lib/league/validate.js';
import { lagosDateTimeToUtcIso, formatDate, formatTime, toLagos } from '../functions/api/_lib/league/time.js';
import { TEAMS, FIXTURES, checkSeason } from '../functions/api/_lib/league/seed.js';

const T = [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Bravo' }, { id: 3, name: 'Charlie' }, { id: 4, name: 'Delta' }];
const RULES = { points_win: 3, points_draw: 1, points_loss: 0 };
let n = 0;
const fx = (home, away, hg, ag, md = 1, status = 'full_time') => ({ id: ++n, matchday: md, home_team_id: home, away_team_id: away, home_goals: hg, away_goals: ag, status, kickoff_at: `2026-11-${String(md).padStart(2, '0')}T15:00:00Z`.replace('-11-0', '-11-0') });
const order = s => s.rows.map(r => r.team.name);
const row = (s, name) => s.rows.find(r => r.team.name === name);

test('a normal table: points, played, goals', () => {
  const s = computeStandings({ teams: T, fixtures: [fx(1, 2, 2, 0), fx(3, 4, 1, 1)], rules: RULES });
  assert.equal(s.preSeason, false);
  assert.deepEqual(order(s), ['Alpha', 'Charlie', 'Delta', 'Bravo']);
  assert.deepEqual(['played', 'won', 'drawn', 'lost', 'gf', 'ga', 'gd', 'points'].map(k => row(s, 'Alpha')[k]), [1, 1, 0, 0, 2, 0, 2, 3]);
  assert.deepEqual(['played', 'drawn', 'points'].map(k => row(s, 'Delta')[k]), [1, 1, 1]);
  assert.equal(row(s, 'Charlie').level, true, 'Charlie and Delta are level on everything');
  assert.deepEqual(row(s, 'Charlie').tiedWith, ['Delta']);
  assert.equal(row(s, 'Delta').decidedBy.criterion, 'alphabetical');
});

test('a tie decided by goal difference', () => {
  const s = computeStandings({ teams: T, fixtures: [fx(1, 2, 3, 0), fx(3, 4, 1, 0)], rules: RULES });
  assert.deepEqual(order(s).slice(0, 2), ['Alpha', 'Charlie']);
  assert.deepEqual(row(s, 'Charlie').decidedBy, { criterion: 'goal_difference', above: 'Alpha', aboveValue: 3, value: 1 });
  assert.match(explainPosition(row(s, 'Charlie'), s.rows), /Level with Alpha until goal difference: Alpha \+3, Charlie \+1/);
});

test('three clubs level on points, goal difference, goals and wins: head-to-head decides', () => {
  // All three on 7 points, +1, 3 scored, 2 wins. Between themselves: Alpha 4 pts, Bravo 3, Charlie 1.
  const fixtures = [fx(1, 2, 2, 0), fx(2, 3, 1, 0), fx(3, 1, 0, 0), fx(1, 4, 1, 0), fx(4, 1, 2, 0), fx(2, 4, 2, 0), fx(4, 2, 0, 0), fx(3, 4, 2, 1), fx(4, 3, 0, 1)];
  const s = computeStandings({ teams: T, fixtures, rules: { ...RULES, tiebreak_order: '["points","goal_difference","goals_for","wins","h2h_points","h2h_goal_difference","h2h_goals_for"]' } });
  for (const name of ['Alpha', 'Bravo', 'Charlie']) assert.deepEqual(['points', 'gd', 'gf', 'won'].map(k => row(s, name)[k]), [7, 1, 3, 2], name);
  assert.deepEqual(order(s), ['Alpha', 'Bravo', 'Charlie', 'Delta']);
  assert.deepEqual(row(s, 'Bravo').decidedBy, { criterion: 'h2h_points', above: 'Alpha', aboveValue: 4, value: 3 });
  assert.deepEqual(row(s, 'Charlie').decidedBy, { criterion: 'h2h_points', above: 'Bravo', aboveValue: 3, value: 1 });
});

test('level on everything: the tie decision, otherwise alphabetical', () => {
  const fixtures = [fx(1, 2, 1, 1)];
  const plain = computeStandings({ teams: T, fixtures, rules: RULES });
  assert.deepEqual(order(plain).slice(0, 2), ['Alpha', 'Bravo']);
  assert.equal(row(plain, 'Bravo').decidedBy.criterion, 'alphabetical');
  assert.equal(row(plain, 'Alpha').level, true);
  const decided = computeStandings({ teams: T, fixtures, rules: RULES, tieOverrides: [{ team_id: 2, rank_hint: 1, reason: 'League ruling 12/2026' }, { team_id: 1, rank_hint: 2, reason: 'League ruling 12/2026' }] });
  assert.deepEqual(order(decided).slice(0, 2), ['Bravo', 'Alpha']);
  assert.equal(row(decided, 'Alpha').decidedBy.criterion, 'tie_override');
});

test('a points deduction (overall table only)', () => {
  const s = computeStandings({ teams: T, fixtures: [fx(1, 2, 1, 0)], adjustments: [{ team_id: 1, points_delta: -3, reason: 'Fielded an ineligible player', is_active: 1 }], rules: RULES });
  assert.equal(row(s, 'Alpha').points, 0);
  assert.equal(row(s, 'Alpha').adjustment, -3);
  assert.deepEqual(order(s), ['Alpha', 'Charlie', 'Delta', 'Bravo'], 'Alpha 0 pts but +1 GD stays above the 0-pt clubs');
  const voided = computeStandings({ teams: T, fixtures: [fx(1, 2, 1, 0)], adjustments: [{ team_id: 1, points_delta: -3, reason: 'x', is_active: 0 }], rules: RULES });
  assert.equal(row(voided, 'Alpha').points, 3, 'a voided adjustment does not count');
  const home = computeStandings({ teams: T, fixtures: [fx(1, 2, 1, 0)], adjustments: [{ team_id: 1, points_delta: -3, reason: 'x', is_active: 1 }], rules: RULES, scope: 'home' });
  assert.equal(row(home, 'Alpha').points, 3, 'home table has no adjustments');
});

test('an awarded 3-0 counts; postponed, cancelled and abandoned do not; live only when allowed', () => {
  const award = validateResultInput({ status: 'awarded' }, { awarded_home_goals: 3, awarded_away_goals: 0 });
  assert.equal(award.ok, true);
  assert.deepEqual([award.value.home_goals, award.value.away_goals, award.value.result_type], [3, 0, 'awarded']);
  const awayAward = validateResultInput({ status: 'awarded', awardedTo: 'away' }, { awarded_home_goals: 3, awarded_away_goals: 0 });
  assert.deepEqual([awayAward.value.home_goals, awayAward.value.away_goals], [0, 3]);
  const fixtures = [{ ...fx(1, 2, 3, 0), status: 'awarded' }, fx(3, 4, null, null, 1, 'postponed'), fx(3, 1, null, null, 1, 'cancelled'), fx(4, 2, 1, 0, 1, 'abandoned'), fx(2, 3, 2, 0, 1, 'live')];
  const s = computeStandings({ teams: T, fixtures, rules: RULES });
  assert.equal(s.matchesPlayed, 1);
  assert.equal(row(s, 'Alpha').points, 3);
  assert.equal(row(s, 'Delta').played, 0);
  assert.equal(row(s, 'Bravo').played, 1, 'live match not counted');
  const live = computeStandings({ teams: T, fixtures, rules: { ...RULES, include_live: 1 } });
  assert.equal(row(live, 'Bravo').played, 2, 'live match counted when include_live');
  assert.equal(isCounted({ status: 'half_time', home_goals: 0, away_goals: 0 }, { include_live: 1 }), true);
  assert.equal(isCounted({ status: 'full_time', home_goals: null, away_goals: 1 }, {}), false);
});

test('home and away tables', () => {
  const fixtures = [fx(1, 2, 2, 0)];
  const home = computeStandings({ teams: T, fixtures, rules: RULES, scope: 'home' });
  const away = computeStandings({ teams: T, fixtures, rules: RULES, scope: 'away' });
  assert.deepEqual([row(home, 'Alpha').played, row(home, 'Bravo').played], [1, 0]);
  assert.deepEqual([row(away, 'Alpha').played, row(away, 'Bravo').played, row(away, 'Bravo').lost], [0, 1, 1]);
});

test('pre-season: alphabetical, everything zero', () => {
  const s = computeStandings({ teams: [...T].reverse(), fixtures: [fx(1, 2, null, null, 1, 'scheduled')], rules: RULES });
  assert.equal(s.preSeason, true);
  assert.deepEqual(order(s), ['Alpha', 'Bravo', 'Charlie', 'Delta']);
  assert.ok(s.rows.every(r => r.points === 0 && r.played === 0));
});

test('form guide: last five, oldest first', () => {
  const fixtures = [fx(1, 2, 1, 0, 1), fx(3, 1, 2, 0, 2), fx(1, 4, 1, 1, 3)];
  assert.deepEqual(buildFormGuide(1, fixtures).map(x => x.r), ['W', 'L', 'D']);
  const s = computeStandings({ teams: T, fixtures, rules: RULES });
  assert.deepEqual(row(s, 'Alpha').form, ['W', 'L', 'D']);
  const many = Array.from({ length: 7 }, (_, i) => fx(1, 2, i % 2, 0, i + 1));
  assert.equal(buildFormGuide(1, many).length, 5);
});

test('movement compared with the previous matchday', () => {
  // After matchday 1: Alpha, Charlie, Delta, Bravo. After matchday 2: Delta, Bravo, Alpha, Charlie.
  const fixtures = [fx(1, 2, 1, 0, 1), fx(3, 4, 0, 0, 1), fx(2, 1, 3, 0, 2), fx(4, 3, 1, 0, 2)];
  const s = computeStandings({ teams: T, fixtures, rules: RULES });
  assert.deepEqual(order(s), ['Delta', 'Bravo', 'Alpha', 'Charlie']);
  assert.deepEqual(s.rows.map(r => r.movement), [2, 2, -2, -2]);
  const after1 = computeStandings({ teams: T, fixtures, rules: RULES, upToMatchday: 1 });
  assert.deepEqual(order(after1), ['Alpha', 'Charlie', 'Delta', 'Bravo']);
  assert.equal(after1.matchday, 1);
});

test('ICS: CRLF, folding at 75 octets, escaping, postponed left out', () => {
  const comp = { name: 'Nigeria National League, Conference D', short_name: 'NNL Conference D' };
  const ics = buildIcs([
    { id: 7, kickoff_at: '2026-11-14T15:00:00Z', status: 'scheduled', updated_at: '2026-11-01 10:00:00', home: { name: 'Kada Warriors FC' }, away: { name: 'Lobi Stars FC' }, venue: { name: 'UBA Sanni Stadium; Kaduna, North' }, competition: comp, matchday: 2 },
    { id: 8, kickoff_at: null, status: 'postponed', home: { name: 'A' }, away: { name: 'B' }, competition: comp, matchday: 3 },
    { id: 9, kickoff_at: '2026-11-21T15:00:00Z', status: 'cancelled', home: { name: 'C' }, away: { name: 'D' }, competition: comp, matchday: 3 },
  ], { calendarName: 'Lobi Stars FC fixtures', now: '2026-11-01T00:00:00Z' });
  assert.ok(ics.includes('\r\n') && !/[^\r]\n/.test(ics), 'CRLF only');
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, `line too long: ${line}`);
  const unfolded = ics.replace(/\r\n /g, '');
  assert.match(unfolded, /SUMMARY:Kada Warriors FC vs Lobi Stars FC \(NNL Conference D\\, Matchday 2\)/);
  assert.match(unfolded, /LOCATION:UBA Sanni Stadium\\; Kaduna\\, North/);
  assert.match(unfolded, /UID:fixture-7@lobistarsfc\.com/);
  assert.match(unfolded, /DTSTART:20261114T150000Z/);
  assert.ok(!unfolded.includes('fixture-8@'), 'postponed (no kick-off) left out');
  assert.match(unfolded, /UID:fixture-9@lobistarsfc\.com[\s\S]*?STATUS:CANCELLED/);
  assert.equal(foldLine('X'.repeat(160)).split('\r\n').length, 3);
  assert.equal(foldLine('é'.repeat(50)).split('\r\n').every(l => new TextEncoder().encode(l).length <= 75), true, 'never splits a character');
});

test('Nigerian time and input checks', () => {
  assert.equal(lagosDateTimeToUtcIso('2026-11-08', '16:00'), '2026-11-08T15:00:00Z');
  assert.equal(lagosDateTimeToUtcIso('08/11/2026', '16:00'), '2026-11-08T15:00:00Z');
  assert.equal(lagosDateTimeToUtcIso('31/02/2027', '16:00'), null);
  assert.equal(formatDate('2026-11-08T15:00:00Z'), 'Sunday 8 November 2026');
  assert.equal(formatTime('2026-11-08T15:00:00Z'), '4:00 PM');
  assert.equal(toLagos('2026-11-07T23:30:00Z').date, '2026-11-08', 'after 11 PM UTC it is the next day in Nigeria');
  assert.equal(validateResultInput({ status: 'full_time', homeGoals: 2 }).ok, false, 'full time needs both scores');
  assert.equal(validateResultInput({ status: 'scheduled', homeGoals: 1, awayGoals: 0 }).ok, false);
  assert.equal(validateResultInput({ status: 'full_time', homeGoals: 31, awayGoals: 0 }).ok, false);
  assert.equal(validateResultInput({ status: 'full_time', homeGoals: '2', awayGoals: '1' }).value.home_goals, 2);
  assert.equal(validateRules({ tiebreakOrder: ['goal_difference', 'points'] }).ok, false, 'points first');
  assert.equal(validateRules({ tiebreakOrder: ['points', 'wins', 'wins'] }).ok, false, 'no duplicates');
  assert.equal(validateRules({ tiebreakOrder: ['points', 'magic'] }).ok, false);
  assert.equal(validateRules({ pointsWin: 6 }).ok, false);
  assert.equal(validateRules({ zones: [{ from: 1, to: 2, label: 'Promotion', colour: '#1A7F37' }, { from: 2, to: 3, label: 'Playoff', colour: '#B45309' }] }).ok, false, 'zones cannot overlap');
  assert.equal(validateRules({ zones: [{ from: 1, to: 9, label: 'X', colour: '#000000' }] }, 8).ok, false);
  assert.equal(validateFixtureInput({ homeTeamId: 1, awayTeamId: 1 }).ok, false);
  assert.match(tiebreakInWords({}), /^Clubs level on points are separated by goal difference/);
});

test('helpers: next fixture and matchday groups', () => {
  const fixtures = [fx(1, 2, null, null, 2, 'scheduled'), fx(3, 1, null, null, 1, 'scheduled')];
  fixtures[0].kickoff_at = '2030-01-08T15:00:00Z'; fixtures[1].kickoff_at = '2030-01-01T15:00:00Z';
  assert.equal(nextFixture(1, fixtures, Date.parse('2029-12-01')).matchday, 1);
  assert.deepEqual(groupByMatchday(fixtures).map(g => g.matchday), [1, 2]);
});

test('the official season passes every data check', () => {
  assert.deepEqual(checkSeason({ teams: TEAMS, fixtures: FIXTURES }), []);
  // And the checks do catch a broken list.
  const broken = FIXTURES.map(f => (f.match_no === 3 ? { ...f, kickoff_at: '2026-11-07T15:00:00Z' } : f));
  assert.ok(checkSeason({ teams: TEAMS, fixtures: broken }).some(p => /not on a Sunday/.test(p)));
  const dup = [...FIXTURES.slice(0, 55), { ...FIXTURES[0], match_no: 56 }];
  assert.ok(checkSeason({ teams: TEAMS, fixtures: dup }).length > 0);
});
