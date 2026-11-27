// Statistics Center: the whole flow on an in-memory database (no server needed): a match from a fixture,
// line-ups, 21 events, the worked-out numbers, the publish checks, publishing (feeds player_match_stats and
// match_centre), undo/restore, offline re-sends, permissions, exports and the public match data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { d1 } from './helpers/d1shim.mjs';
import { DEMO_ROSTER, DEMO_EVENT, DEMO_LINEUPS, DEMO_EVENTS } from './fixtures/stats-centre-demo.mjs';
import { createMatch, saveLineups, applyEvents, getMatch, setClock, publish, reopen, saveSetup, derive, validate, parseEvent, publishedMatches, playerTotals, teamTotals,
  eventsCsv, publicMatch, removeMatch, toCsv } from '../functions/api/_lib/statsCentreData.js';
import { ensureStatsCentreSchema, passwordProblem, tempPasswordProblem, loginIdProblem } from '../functions/api/_lib/statsCentre.js';

const STATS = { id: 'sxu_stat', loginId: 'Jiki01', fullName: 'Jiki Benjamin', canPublish: false };
const SENIOR = { ...STATS, id: 'sxu_senior', loginId: 'Senior01', fullName: 'Senior Statistician', canPublish: true };
const ADMIN = { id: 'admin:1', loginId: 'owner@example.com', fullName: 'Owner', canPublish: true, admin: true };

// One database for the whole file (the server code creates its tables once per run); each test gets its own fixture.
const db = d1();
db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, ''));
let n = 0;
async function setup() {
  const ev = { ...DEMO_EVENT, id: `${DEMO_EVENT.id}_${++n}` };
  await db.prepare(`INSERT INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0)`)
    .bind(ev.id, ev.home_team, ev.away_team, ev.competition, ev.event_date, ev.venue).run();
  await ensureStatsCentreSchema(db);
  const { id } = await createMatch(db, STATS, { eventId: ev.id }, { startMonth: 8 });
  return { db, id, ev };
}
// Event ids are unique per match in real use; here every test reuses the demo events, so give them a per-match prefix.
const demoOps = id => DEMO_EVENTS.map(event => ({ op: 'save', event: { ...event, id: `${id.slice(-6)}${event.id}` } }));
const saveAll = (db, id, user = STATS) => applyEvents(db, user, id, demoOps(id), DEMO_ROSTER);

test('a match from a fixture: teams, season, home side; the same fixture cannot be recorded twice', async () => {
  const { db, id } = await setup();
  const m = (await getMatch(db, id)).match;
  assert.equal(m.home, 'Lobi Stars FC'); assert.equal(m.lobiHome, true); assert.equal(m.season, '2026/27'); assert.equal(m.status, 'draft'); assert.equal(m.kickoff, '16:00');
  const again = await createMatch(db, STATS, { eventId: (await db.prepare('SELECT event_id FROM sx_matches WHERE id = ?').bind(id).first()).event_id }, {});
  assert.match(again.error, /already/); assert.equal(again.id, id);
  assert.match((await createMatch(db, STATS, { home: 'A FC', away: 'B FC', date: '2026-12-01' }, {})).error, /Lobi Stars/);
});

test('line-ups: Lobi Stars players must be in the squad; opponents by name', async () => {
  const { db, id } = await setup();
  assert.match((await saveLineups(db, STATS, id, { home: [{ slug: 'not-a-player', starter: true }], away: [] }, DEMO_ROSTER)).error, /squad/);
  assert.equal((await saveLineups(db, STATS, id, DEMO_LINEUPS, DEMO_ROSTER)).ok, true);
  const d = await getMatch(db, id);
  assert.equal(d.lineups.filter(l => l.side === 'home' && l.starter).length, 11);
  assert.equal(d.lineups.filter(l => l.side === 'away').length, 14);
});

test('events: the score, half-time score and "score at the time" come from the goals; own goals count for the right team', async () => {
  const { db, id } = await setup();
  await saveLineups(db, STATS, id, DEMO_LINEUPS, DEMO_ROSTER);
  const r = await saveAll(db, id);
  assert.ok(r.results.every(x => x.ok), JSON.stringify(r.results.filter(x => !x.ok)));
  await setClock(db, STATS, id, { action: 'full_time' }, {});
  const d = await getMatch(db, id);
  assert.equal(d.match.homeScore, 3); assert.equal(d.match.awayScore, 1);
  assert.equal(d.match.htHome, 1); assert.equal(d.match.htAway, 1);
  assert.equal(d.match.status, 'review');
  const og = d.events.find(e => e.detail === 'own_goal');
  assert.equal(og.side, 'home'); assert.equal(og.scoreHome, 3); assert.equal(og.scoreAway, 1);
  assert.equal(d.events.find(e => e.minute === 34 && e.type === 'goal').scoreAway, 1);
});

test('worked-out numbers: team stats, minutes, goals, assists, cards', async () => {
  const { db, id } = await setup();
  await saveLineups(db, STATS, id, DEMO_LINEUPS, DEMO_ROSTER);
  await saveAll(db, id);
  const { derived: d } = await getMatch(db, id);
  const H = d.team.home, A = d.team.away;
  assert.deepEqual([H.goals, H.shots, H.shotsOnTarget, H.corners, H.yellow, H.offsides, H.saves], [3, 5, 2, 2, 1, 1, 1]); // 3 shots + 2 goals (the own goal is not a shot)
  assert.deepEqual([A.goals, A.shots, A.shotsOnTarget, A.fouls, A.yellow, A.red], [1, 2, 2, 1, 1, 1]);
  const p = slug => d.players.find(x => x.slug === slug);
  assert.equal(p('demo-player-9').goals, 1); assert.equal(p('demo-player-8').assists, 1); assert.equal(p('demo-player-8').goals, 1);
  assert.equal(p('demo-player-10').minutes, 46); assert.equal(p('demo-player-16').minutes, 44); // off/on at 46
  assert.equal(p('demo-player-3').minutes, 71); assert.equal(p('demo-player-13').minutes, 19);
  assert.equal(p('demo-player-1').minutes, 90); assert.equal(p('demo-player-14').minutes, 0); assert.equal(p('demo-player-14').played, false);
  assert.equal(d.players.find(x => x.name === 'Visitor 5').ownGoals, 1);
  assert.equal(d.players.find(x => x.name === 'Visitor 4').minutes, 85); // sent off
});

test('checks before publishing: 11 starters, valid substitutions, minutes inside the half, nothing after a red card', async () => {
  const { db, id } = await setup();
  await saveAll(db, id);
  let c = (await getMatch(db, id)).check;
  assert.ok(c.errors.some(e => /starters/.test(e)), 'no line-up yet');
  await saveLineups(db, STATS, id, DEMO_LINEUPS, DEMO_ROSTER);
  c = (await getMatch(db, id)).check;
  assert.deepEqual(c.errors, []);
  // A substitute who never started cannot go off before coming on; a minute outside the half; an event after a red card.
  await applyEvents(db, STATS, id, [
    { op: 'save', event: { id: 'badsub000001', side: 'home', type: 'substitution', minute: 75, period: '2H', slug: 'demo-player-15', relatedSlug: 'demo-player-14' } },
    { op: 'save', event: { id: 'badmin000001', side: 'home', type: 'corner', minute: 60, period: '1H' } },
    { op: 'save', event: { id: 'afterred0001', side: 'away', type: 'foul_committed', minute: 88, period: '2H', name: 'Visitor 4' } },
  ], DEMO_ROSTER);
  c = (await getMatch(db, id)).check;
  assert.ok(c.errors.some(e => /was not on the pitch/.test(e)));
  assert.ok(c.errors.some(e => /outside the first half/.test(e)));
  assert.ok(c.errors.some(e => /already sent off/.test(e)));
});

test('undo and restore; the same event sent twice (offline re-send) is kept once', async () => {
  const { db, id } = await setup();
  await saveLineups(db, STATS, id, DEMO_LINEUPS, DEMO_ROSTER);
  await saveAll(db, id);
  await saveAll(db, id); // sent again
  let d = await getMatch(db, id);
  assert.equal(d.events.length, DEMO_EVENTS.length);
  const last = demoOps(id).map(o => o.event).find(e => e.type === 'goal' && e.detail === 'own_goal');
  await applyEvents(db, STATS, id, [{ op: 'delete', id: last.id }], DEMO_ROSTER);
  d = await getMatch(db, id);
  assert.equal(d.match.homeScore, 2); assert.equal(d.deleted.length, 1);
  await applyEvents(db, STATS, id, [{ op: 'restore', id: last.id }], DEMO_ROSTER);
  assert.equal((await getMatch(db, id)).match.homeScore, 3);
  const log = (await db.prepare(`SELECT action FROM sx_activity WHERE item_id = ?`).bind(last.id).all()).results.map(r => r.action);
  assert.ok(log.includes('add_event') && log.includes('delete_event'));
  await assert.rejects(db.prepare(`DELETE FROM sx_activity`).run(), /cannot be deleted/);
});

test('publishing: only with "may publish"; feeds player_match_stats and the match page; locked until reopened', async () => {
  const { db, id, ev } = await setup();
  await saveLineups(db, STATS, id, DEMO_LINEUPS, DEMO_ROSTER);
  await saveAll(db, id);
  await setClock(db, STATS, id, { action: 'full_time' }, {});
  assert.match((await publish(db, STATS, id, {})).error, /senior statistician/);
  assert.equal((await publish(db, SENIOR, id, {})).ok, true);
  const d = await getMatch(db, id);
  assert.equal(d.match.status, 'published'); assert.equal(d.match.verifiedBy, 'Senior Statistician (Senior01)');
  const stats = (await db.prepare(`SELECT * FROM player_match_stats WHERE event_id = ? ORDER BY player_slug`).bind(ev.id).all()).results;
  const s9 = stats.find(r => r.player_slug === 'demo-player-9');
  assert.deepEqual([s9.played, s9.started, s9.goals, s9.minutes], [1, 1, 1, 90]);
  assert.equal(stats.find(r => r.player_slug === 'demo-player-6').yellow, 1);
  assert.ok(!stats.some(r => r.player_slug === 'demo-player-14'), 'an unused substitute is not counted');
  const mc = await db.prepare(`SELECT * FROM match_centre WHERE event_id = ?`).bind(ev.id).first();
  assert.deepEqual([mc.status, mc.home_score, mc.away_score], ['full-time', 3, 1]);
  assert.deepEqual(JSON.parse(mc.stats_json).shots, [5, 2]);
  assert.ok(JSON.parse(mc.timeline_json).some(t => t.type === 'own-goal'));
  assert.equal(JSON.parse(mc.squad_json).starting.length, 11);
  // Locked; reopening keeps the public version.
  assert.match((await applyEvents(db, SENIOR, id, [{ op: 'delete', id: demoOps(id)[0].event.id }], DEMO_ROSTER)).error, /published/);
  assert.match((await saveSetup(db, SENIOR, id, { attendance: 5000 }, {})).error, /published/);
  assert.match((await removeMatch(db, ADMIN, id, {})).error, /published/);
  assert.equal((await reopen(db, ADMIN, id, {})).ok, true);
  assert.equal((await publicMatch(db, 'nope')), null);
  const pub = (await publishedMatches(db, '2026/27')).filter(x => x.id === id);
  assert.equal(pub.length, 1, 'still public while being corrected');
});

test('season totals, team record, head-to-head and the public match data', async () => {
  const { db, id, ev } = await setup();
  await saveLineups(db, STATS, id, DEMO_LINEUPS, DEMO_ROSTER);
  await saveAll(db, id);
  await publish(db, ADMIN, id, {});
  const snaps = (await publishedMatches(db, '2026/27')).filter(x => x.id === id);
  const players = playerTotals(snaps);
  assert.equal(players[0].goals, 1);
  const keeper = players.find(p => p.slug === 'demo-player-1');
  assert.equal(keeper.cleanSheets, 0, 'conceded one');
  assert.equal(players.find(p => p.slug === 'demo-player-9').matches[0].score, '3–1');
  const t = teamTotals(snaps);
  assert.deepEqual([t.all.p, t.all.w, t.all.gf, t.all.ga, t.home.w], [1, 1, 3, 1, 1]);
  assert.equal(t.h2h[0].opponent, 'Demo United FC'); assert.equal(t.form[0].r, 'W');
  const slug = (await import('../functions/api/_lib/matchSlug.js')).matchSlug(ev);
  const pm = await publicMatch(db, slug);
  assert.equal(pm.match.homeScore, 3); assert.equal(pm.matchUrl, `/matches/${slug}/`);
  assert.ok(!('clock' in pm.match) || pm.match.clock === undefined);
});

test('exports: CSV with every event; cells that look like formulas are made safe', async () => {
  const { db, id } = await setup();
  await saveLineups(db, STATS, id, DEMO_LINEUPS, DEMO_ROSTER);
  await saveAll(db, id);
  const csv = await eventsCsv(db, { matchId: id });
  assert.equal(csv.trim().split('\r\n').length, DEMO_EVENTS.length + 1);
  assert.match(csv, /Own goal|own_goal/);
  assert.equal(toCsv([['=SUM(A1)', 'a,b']]), "\"'=SUM(A1)\",\"a,b\"\r\n");
});

test('event checks and passwords', () => {
  const ctx = { lobiSide: 'home', bySlug: new Map(DEMO_ROSTER.map(p => [p.slug, p])) };
  assert.match(parseEvent({ id: 'short', type: 'goal' }, ctx).error, /id/);
  assert.match(parseEvent({ id: 'abcdefgh12', type: 'dance', side: 'home', period: '1H', minute: 3 }, ctx).error, /type/);
  assert.match(parseEvent({ id: 'abcdefgh12', type: 'goal', side: 'home', period: '1H', minute: 3, slug: 'someone-else' }, ctx).error, /squad/);
  const og = parseEvent({ id: 'abcdefgh12', type: 'goal', side: 'home', period: '2H', minute: 50, detail: 'own_goal', name: 'Visitor 5' }, ctx).value;
  assert.equal(og.player_name, 'Visitor 5'); assert.equal(og.player_slug, null);
  assert.equal(tempPasswordProblem('123456789'), null, 'a Super Admin may set a simple temporary password');
  assert.ok(passwordProblem('123456789x'.slice(0, 9)), 'but nobody may choose it as their own');
  assert.equal(passwordProblem('Benue-River-2026', 'Jiki01'), null);
  assert.equal(loginIdProblem('Jiki01'), null); assert.ok(loginIdProblem('Jiki Benjamin'));
  const v = validate({ length: 90, lobiHome: true, homeScore: 0, awayScore: 0, home: 'Lobi Stars FC', away: 'X', clock: { period: 'FT' } }, [], []);
  assert.ok(v.errors.some(e => /11/.test(e)));
  assert.equal(derive({ length: 90 }, [], []).score.home, 0);
});
