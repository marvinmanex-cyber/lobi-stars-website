// Statistics Center Phase 2 on an in-memory database: the xG model (known distances and angles, penalty, header v
// foot, idempotent recalculation), positions and zones, xG ownership in the BST grid, video clip times, set pieces,
// ratings and per-90 figures, season analytics, scouting, training tags, the monthly report, and nothing of Phase 2 in
// the public feed. Events without a position, xG or video still save and show.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { d1 } from './helpers/d1shim.mjs';
import { DEMO_ROSTER, DEMO_EVENT, DEMO_LINEUPS, DEMO_EVENTS } from './fixtures/stats-centre-demo.mjs';
import { createMatch, saveLineups, applyEvents, getMatch, publish, saveSetup, setClock } from '../functions/api/_lib/statsCentreData.js';
import { xgFor, shotGeometry, zoneOf, clipSecond, clipUrl, recalcXg, saveRatings, saveXgParams, addScoutingNote, saveTheme, addTag, themeReport, ensurePhase2Schema } from '../functions/api/_lib/statsPhase2.js';
import { mapEvents, playerProfile, comparePlayers, seasonAnalytics, scoutingReport, buildMonthlyReport, reportsList, monthlyReportTick } from '../functions/api/_lib/statsAnalytics.js';
import { createAnalysis, getAnalysis, setCell } from '../functions/api/_lib/statsBst.js';
import { publicFeed } from '../functions/api/_lib/statsExtras.js';

const U = { id: 'sxu_j', loginId: 'Jiki01', fullName: 'Jiki Benjamin', canPublish: true };
const db = d1();
db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, ''));
const xAt = m => 100 - (m * 100) / 105;
let n = 0;
async function recorded({ withPositions = true } = {}) {
  const ev = `p2_ev_${++n}`;
  await db.prepare(`INSERT INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0)`)
    .bind(ev, DEMO_EVENT.home_team, DEMO_EVENT.away_team, DEMO_EVENT.competition, DEMO_EVENT.event_date, DEMO_EVENT.venue).run();
  const { id } = await createMatch(db, U, { eventId: ev }, {});
  await saveLineups(db, U, id, DEMO_LINEUPS, DEMO_ROSTER);
  const pos = { goal: [xAt(8), 50], shot: [xAt(20), 40] };
  await applyEvents(db, U, id, DEMO_EVENTS.map(e => ({ op: 'save', event: { ...e, id: `${id.slice(-6)}${e.id}`, ...(withPositions && pos[e.type] && e.detail !== 'own_goal' ? { x: pos[e.type][0], y: pos[e.type][1] } : {}), ...(e.type === 'corner' ? { routine: 'near_post', setPieceOutcome: 'shot' } : {}) } })), DEMO_ROSTER);
  await setClock(db, U, id, { action: 'full_time' }, {});
  return id;
}

test('xG model: known distances and angles, penalty, header v foot, out of range positions', () => {
  const g = shotGeometry(xAt(11), 50);
  assert.ok(Math.abs(g.distance - 11) < 0.01); assert.ok(Math.abs(g.angle - 0.642) < 0.01, `angle ${g.angle}`);
  assert.equal(xgFor({ pitch_x: xAt(5.5), pitch_y: 50 }), 0.6); assert.equal(xgFor({ pitch_x: xAt(11), pitch_y: 50 }), 0.33); assert.equal(xgFor({ pitch_x: xAt(25), pitch_y: 50 }), 0.045);
  assert.ok(xgFor({ pitch_x: xAt(11), pitch_y: 50, body_part: 'head' }) < xgFor({ pitch_x: xAt(11), pitch_y: 50, body_part: 'right_foot' }), 'a header is less likely to score');
  assert.ok(xgFor({ pitch_x: xAt(3), pitch_y: 90 }) < xgFor({ pitch_x: xAt(3), pitch_y: 50 }), 'a tight angle is less likely');
  assert.equal(xgFor({ detail: 'penalty' }), 0.76); assert.equal(xgFor({ detail: 'penalty' }, { penalty: 0.79 }), 0.79);
  assert.equal(xgFor({}), null, 'no position, no xG');
  assert.equal(zoneOf(90, 20), 'A-L'); assert.equal(zoneOf(50, 50), 'M-C'); assert.equal(zoneOf(null, 1), null);
});

test('events keep position, zone and worked-out xG; xA goes to the passer; events without a position still work', async () => {
  const id = await recorded();
  const d = await getMatch(db, id);
  const goal = d.events.find(e => e.type === 'goal' && e.minute === 12);
  assert.equal(goal.zone, 'A-C'); assert.equal(goal.xgSource, 'auto'); assert.ok(goal.xg > 0.2 && goal.xg < 0.4, `xg ${goal.xg} (a header from 8 m)`);
  const pen = d.events.find(e => e.detail === 'penalty'); assert.equal(pen.xg, 0.76, 'the penalty goal');
  assert.equal(d.events.find(e => e.detail === 'own_goal').xg, null, 'no xG for an own goal');
  const p8 = d.derived.players.find(p => p.slug === 'demo-player-8');
  assert.ok(p8.xa > 0, 'assist on the 12th-minute goal'); assert.ok(d.derived.team.home.xg > 1);
  const plain = await recorded({ withPositions: false });
  const dp = await getMatch(db, plain);
  assert.equal(dp.events.length, DEMO_EVENTS.length);
  assert.ok(dp.events.filter(e => e.type === 'shot').every(e => e.xg === null));
  // typed by hand wins, and recalculation keeps it
  const shot = d.events.find(e => e.type === 'shot' && e.minute === 4);
  await applyEvents(db, U, id, [{ op: 'save', event: { ...shot, xgManual: 0.5 } }], DEMO_ROSTER);
  await recalcXg(db, U, { matchId: id }, {});
  assert.equal((await getMatch(db, id)).events.find(e => e.id === shot.id).xg, 0.5);
});

test('recalculation is idempotent and follows new settings', async () => {
  const id = await recorded();
  const first = await recalcXg(db, U, { matchId: id }, {});
  assert.equal(first.changed, 0, 'already up to date');
  await saveXgParams(db, U, { penalty: 0.8 }, {});
  const r = await recalcXg(db, U, { matchId: id }, {});
  assert.ok(r.changed >= 1);
  assert.equal((await getMatch(db, id)).events.find(e => e.detail === 'penalty').xg, 0.8);
  assert.equal((await recalcXg(db, U, { matchId: id }, {})).changed, 0, 'running again changes nothing');
  await saveXgParams(db, U, {}, {});
  await recalcXg(db, U, { matchId: id }, {});
});

test('BST: the xG row is the sum of the shots\' xG; typing over it is refused; other blocks can still be typed', async () => {
  const id = await recorded();
  const { id: aid } = await createAnalysis(db, U, id, {});
  const d = await getAnalysis(db, aid);
  const full = await getMatch(db, id);
  const shotXg = full.events.filter(e => e.side === 'home' && (e.type === 'shot' || e.type === 'goal') && e.detail !== 'own_goal' && e.xg).reduce((a, e) => a + e.xg, 0);
  assert.ok(Math.abs(d.totals.lobi.xg.full - shotXg) < 0.05, `${d.totals.lobi.xg.full} v ${shotXg}`);
  assert.match((await setCell(db, U, aid, { metric: 'xg', side: 'lobi', period: '1H', block: '12', value: 0.9 }, {})).error, /comes from its shots/);
  assert.equal((await setCell(db, U, aid, { metric: 'xg', side: 'lobi', period: '1H', block: '30', value: 0.2 }, {})).ok, true);
});

test('video clip times for both halves and the link formats', () => {
  const m = { video_offset_seconds: 95, video_second_half_offset_seconds: 3720 };
  assert.equal(clipSecond(m, { period: '1H', minute: 1 }), 85, '10 seconds before kick-off + 0');
  assert.equal(clipSecond(m, { period: '1H', minute: 30 }), 95 + 29 * 60 - 10);
  assert.equal(clipSecond(m, { period: '1H', minute: 45, stoppage: 2 }), 95 + 46 * 60 - 10);
  assert.equal(clipSecond(m, { period: '2H', minute: 46 }), 3710); assert.equal(clipSecond(m, { period: '2H', minute: 60 }), 3720 + 14 * 60 - 10);
  assert.equal(clipSecond({}, { period: '1H', minute: 5 }), null, 'no offset, no clip');
  assert.match(clipUrl('https://youtu.be/XyZ', 100), /embed\/XyZ\?start=100&end=125/);
  assert.equal(clipUrl('not a url', 5), null);
});

test('set pieces, ratings, per-90, season analytics, maps', async () => {
  const id = await recorded();
  await publish(db, U, id, {});
  const lu = (await getMatch(db, id)).lineups.filter(l => l.side === 'home');
  await saveRatings(db, U, id, lu.map((l, i) => ({ id: l.id, rating: i === 8 ? 8.5 : 7, note: i === 8 ? 'Excellent movement' : '' })), {});
  const p = await playerProfile(db, 'demo-player-9', '2026/27', DEMO_ROSTER);
  const row = p.rows.find(r => r.matchId === id); assert.ok(p.apps >= 1); assert.equal(row.rating, 8.5); assert.equal(row.ratingNote, 'Excellent movement');
  assert.equal(p.per90.goals, Math.round((p.totals.goals * 90 / p.minutes) * 100) / 100);
  const cmp = await comparePlayers(db, ['demo-player-9', 'demo-player-14'], '2026/27', { minMinutes: 90 });
  assert.equal(cmp.players.find(x => x.slug === 'demo-player-14').enough, false, 'an unused substitute is flagged');
  const a = await seasonAnalytics(db, '2026/27');
  assert.ok(a.matches >= 1); assert.equal(a.periods.reduce((t, x) => t + x.for + x.against, 0), a.trend.reduce((t, r) => t + r.goalsFor + r.goalsAgainst, 0), 'goals by 15 minutes add up');
  assert.ok(a.setPieces.routine.some(r => r.key === 'near_post' && r.success >= 1));
  assert.ok(a.setPieces.goalsFor >= 1, 'the penalty goal counts as a set-piece goal');
  const shots = await mapEvents(db, { season: '2026/27', types: 'shot,goal' });
  assert.ok(shots.length > 0 && shots.every(e => e.x !== null));
});

test('scouting report and notes; training tags and their report; the monthly report (and the timer only once)', async () => {
  const id = await recorded();
  await addScoutingNote(db, U, { teamKey: 'demo united', teamName: 'Demo United FC', season: '2026/27', note: 'Their No. 9 likes the far post.' }, {});
  const sc = await scoutingReport(db, 'Demo United F.C.');
  assert.ok(sc.played >= 1); assert.equal(sc.notes[0].note, 'Their No. 9 likes the far post.');
  const { id: themeId } = await saveTheme(db, U, { name: 'Set-piece attacking', description: 'near-post corners' }, {});
  const corner = (await getMatch(db, id)).events.find(e => e.type === 'corner');
  await addTag(db, U, { themeId, eventId: corner.id, note: 'worked on Tuesday' }, {});
  await addTag(db, U, { themeId, eventId: corner.id }, {});
  const tr = await themeReport(db, themeId);
  assert.equal(tr.items.length, 1, 'tagging the same event twice keeps one tag');
  assert.equal(tr.months[0].setPieceSuccess, 1);
  await ensurePhase2Schema(db);
  const r = await buildMonthlyReport(db, U, '2026/27', '2026-11', {});
  assert.match(r.html, /Lobi Stars FC · Season summary/); assert.ok(!/Binary/i.test(r.html));
  assert.equal((await reportsList(db)).filter(x => x.period === '2026-11').length, 1);
  const first = await monthlyReportTick({ DB: db }, Date.parse('2026-12-01T07:30:00Z'));
  const again = await monthlyReportTick({ DB: db }, Date.parse('2026-12-01T08:30:00Z'));
  assert.ok(first.ok || first.skipped); assert.equal(again.skipped, true, 'only once a month');
  assert.equal((await monthlyReportTick({ DB: db }, Date.parse('2026-12-02T08:00:00Z'))).skipped, true, 'only on the 1st');
});

test('public feed and public data stay free of Phase 2 analysis', async () => {
  const f = JSON.stringify(await publicFeed(db, '2026/27'));
  assert.ok(!/xg|rating|routine|pitch|scouting|Excellent movement|far post/i.test(f), 'no xG, ratings, routines, positions or notes');
});
