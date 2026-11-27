// Statistics Center › BST Analysis Form on an in-memory database: one analysis per match, the 2-minute blocks,
// the grid and live entry showing the same events, analyst cells (counts add up safely, xG/xA limits), the
// overview's conflict guard, Final (checks, lock, Super Admin reopen) and the Excel export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { d1 } from './helpers/d1shim.mjs';
import { DEMO_ROSTER, DEMO_EVENT, DEMO_LINEUPS, DEMO_EVENTS } from './fixtures/stats-centre-demo.mjs';
import { createMatch, saveLineups, applyEvents, saveSetup, getMatch } from '../functions/api/_lib/statsCentreData.js';
import { createAnalysis, getAnalysis, setCell, setText, setStoppage, finalise, reopenAnalysis, blocksFor, blockOf, listAnalyses, bstSheets } from '../functions/api/_lib/statsBst.js';
import { buildXlsx } from '../functions/api/_lib/xlsx.js';

const STAT = { id: 'sxu_j', loginId: 'Jiki01', fullName: 'Jiki Benjamin', canPublish: false };
const OTHER = { id: 'sxu_o', loginId: 'Other02', fullName: 'Other Analyst', canPublish: false };
const ADMIN = { id: 'admin:1', loginId: 'owner@example.com', fullName: 'Owner', canPublish: true, admin: true };
const db = d1();
db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, ''));
let n = 0;
async function setup({ lineups = true, events = true } = {}) {
  const ev = { ...DEMO_EVENT, id: `bst_ev_${++n}` };
  await db.prepare(`INSERT INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0)`)
    .bind(ev.id, ev.home_team, ev.away_team, ev.competition, ev.event_date, ev.venue).run();
  const { id: matchId } = await createMatch(db, STAT, { eventId: ev.id }, {});
  if (lineups) await saveLineups(db, STAT, matchId, DEMO_LINEUPS, DEMO_ROSTER);
  if (events) await applyEvents(db, STAT, matchId, DEMO_EVENTS.map(e => ({ op: 'save', event: { ...e, id: `${matchId.slice(-6)}${e.id}` } })), DEMO_ROSTER);
  const { id } = await createAnalysis(db, STAT, matchId, {});
  return { matchId, id };
}

test('2-minute blocks: labels, events in the right block, added time', () => {
  assert.equal(blocksFor('1H').length, 23); assert.deepEqual(blocksFor('1H').slice(-2), ['44', '45']);
  assert.deepEqual(blocksFor('2H', 2).slice(-4), ['89', '90', '90+2', '90+4']);
  assert.deepEqual(blocksFor('ET1'), ['92', '94', '96', '98', '100', '102', '104', '105']);
  assert.equal(blockOf({ period: '1H', minute: 1 }), '2'); assert.equal(blockOf({ period: '1H', minute: 2 }), '2'); assert.equal(blockOf({ period: '1H', minute: 3 }), '4');
  assert.equal(blockOf({ period: '1H', minute: 45 }), '45'); assert.equal(blockOf({ period: '1H', minute: 45, stoppage: 3 }), '45+4');
  assert.equal(blockOf({ period: '2H', minute: 46 }), '47'); assert.equal(blockOf({ period: '2H', minute: 90 }), '90');
});

test('one analysis per match; a match is needed first; everything known is filled in', async () => {
  const { matchId, id } = await setup();
  const again = await createAnalysis(db, STAT, matchId, {});
  assert.match(again.error, /already/); assert.equal(again.id, id);
  assert.equal((await createAnalysis(db, STAT, 'no-such-match', {})).needMatch, true);
  const d = await getAnalysis(db, id, STAT);
  assert.equal(d.match.home, 'Lobi Stars FC'); assert.equal(d.lineups.filter(l => l.starter && l.side === 'home').length, 11);
  assert.equal(d.analysis.preparedBy, 'Jiki Benjamin'); assert.equal(d.analysis.status, 'draft');
  assert.ok((await listAnalyses(db)).analyses.some(a => a.id === id));
});

test('the grid reads the events: shots, corners, cards, goals for and against, goal attempts worked out', async () => {
  const { id } = await setup();
  const d = await getAnalysis(db, id);
  const L = d.totals.lobi, O = d.totals.opponent;
  assert.equal(L.goal_for.full, 3); assert.equal(L.goal_against.full, 1); assert.equal(O.goal_for.full, 1); assert.equal(O.goal_against.full, 3);
  assert.equal(L.corner.full, 2); assert.equal(L.cards.full, 1); assert.equal(O.cards.full, 2);
  assert.equal(L.shot_on.full, 2, 'two Lobi goals that were not own goals'); assert.equal(L.shot_off.full, 2, 'off target + woodwork'); assert.equal(L.blocked.full, 1);
  assert.equal(L.goal_attempt.full, L.shot_on.full + L.shot_off.full + L.blocked.full);
  assert.equal(d.grid.lobi.goal_for['1H']['12'], 1); assert.equal(d.grid.lobi.blocked['1H']['45+2'], 1, 'the 45+2 shot');
  assert.equal(d.stoppage['1H'], 1, 'a stoppage block appears for an event in added time');
  assert.equal(L.gk_save.full, 1); assert.equal(L.offside.full, 1); assert.equal(L.foul.full, 1);
});

test('a + in the grid is an event (shown on the live screen), a − removes the latest in that block', async () => {
  const { matchId, id } = await setup({ events: false });
  // The page sends grid taps as events of the match (same list as live entry).
  await applyEvents(db, STAT, matchId, [{ op: 'save', event: { id: 'gridtap0001', side: 'home', type: 'corner', period: '1H', minute: 24 } }, { op: 'save', event: { id: 'gridtap0002', side: 'home', type: 'corner', period: '1H', minute: 24 } }], DEMO_ROSTER);
  let d = await getAnalysis(db, id);
  assert.equal(d.grid.lobi.corner['1H']['24'], 2);
  assert.equal((await getMatch(db, matchId)).events.filter(e => e.type === 'corner').length, 2, 'the live feed has them too');
  const r = await applyEvents(db, STAT, matchId, [{ op: 'save', event: { id: 'gridtap0003', side: 'home', type: 'corner', period: '1H', minute: 24 } }], DEMO_ROSTER);
  assert.ok(!r.results[0].duplicateOf, 'team-level taps in the same block are normal, no warning');
  const p = { side: 'home', type: 'foul_committed', period: '1H', minute: 30, slug: 'demo-player-6' };
  await applyEvents(db, STAT, matchId, [{ op: 'save', event: { ...p, id: 'dupcheck0001' } }], DEMO_ROSTER);
  const r2 = await applyEvents(db, STAT, matchId, [{ op: 'save', event: { ...p, id: 'dupcheck0002' } }], DEMO_ROSTER);
  assert.ok(r2.results[0].duplicateOf, 'the same player, event and minute again is flagged as a possible duplicate (not refused)');
  await applyEvents(db, STAT, matchId, [{ op: 'delete', id: 'gridtap0003' }], DEMO_ROSTER);
  d = await getAnalysis(db, id);
  assert.equal(d.grid.lobi.corner['1H']['24'], 2);
});

test('analyst cells: + and − add up (two people tapping both count); xG/xA from 0.00 to 9.99; worked-out rows cannot be typed', async () => {
  const { id } = await setup({ events: false });
  await setCell(db, STAT, id, { metric: 'offence_attack', side: 'lobi', period: '1H', block: '10', delta: 1 }, {});
  await setCell(db, OTHER, id, { metric: 'offence_attack', side: 'lobi', period: '1H', block: '10', delta: 1 }, {});
  await setCell(db, STAT, id, { metric: 'offence_attack', side: 'lobi', period: '1H', block: '10', delta: 1 }, {});
  const r = await setCell(db, STAT, id, { metric: 'offence_attack', side: 'lobi', period: '1H', block: '10', delta: -1 }, {});
  assert.equal(r.value, 2);
  assert.equal((await setCell(db, STAT, id, { metric: 'xg', side: 'lobi', period: '2H', block: '62', value: 0.37 }, {})).error, 'Unknown block.'); // 2nd-half blocks end on odd minutes (47 … 89)
  assert.equal((await setCell(db, STAT, id, { metric: 'xg', side: 'lobi', period: '2H', block: '61', value: 0.37 }, {})).value, 0.37);
  assert.match((await setCell(db, STAT, id, { metric: 'xa', side: 'lobi', period: '2H', block: '61', value: 12 }, {})).error, /9\.99/);
  assert.match((await setCell(db, STAT, id, { metric: 'goal_attempt', side: 'lobi', period: '1H', block: '10', delta: 1 }, {})).error, /worked out/);
  assert.match((await setCell(db, STAT, id, { metric: 'corner', side: 'lobi', period: '1H', block: '10', delta: 1 }, {})).error, /worked out/);
  await setCell(db, STAT, id, { metric: 'defense', side: 'opponent', period: '1H', block: '45+2', delta: 1 }, {});
  const d = await getAnalysis(db, id);
  assert.equal(d.totals.lobi.offence_attack.full, 2); assert.equal(d.totals.lobi.xg.full, 0.37); assert.equal(d.grid.opponent.defense['1H']['45+2'], 1);
  assert.equal(d.stoppage['1H'], 1);
  const log = (await db.prepare(`SELECT COUNT(*) AS n FROM sx_activity WHERE item_id = ? AND action = 'bst_cell'`).bind(id).first()).n;
  assert.ok(log >= 6, 'every change is in the activity log');
});

test('the overview: saved, and a save from an older copy is refused instead of overwriting', async () => {
  const { id } = await setup({ events: false });
  assert.equal((await setText(db, STAT, id, { field: 'overview', value: 'Strong press early.', baseText: '' }, {})).ok, true);
  const clash = await setText(db, OTHER, id, { field: 'overview', value: 'My version.', baseText: '' }, {});
  assert.equal(clash.conflict, true); assert.equal(clash.current, 'Strong press early.');
  assert.equal((await setText(db, OTHER, id, { field: 'overview', value: 'Strong press early. Tired after 70.', baseText: 'Strong press early.' }, {})).ok, true);
  assert.equal((await getAnalysis(db, id)).analysis.overview, 'Strong press early. Tired after 70.');
  assert.equal((await setStoppage(db, STAT, id, { period: '2H', count: 3 }, {})).ok, true);
  assert.equal((await getAnalysis(db, id)).stoppage['2H'], 3);
});

test('Final: needs 11 starters and both Lobi formations; then read only; only a Super Admin reopens', async () => {
  const { matchId, id } = await setup();
  let f = await finalise(db, STAT, id, {});
  assert.ok(f.checks.errors.some(e => /formations/.test(e)));
  await saveSetup(db, STAT, matchId, { formationHome: '4-4-2', formationHomeFinish: '4-3-3' }, {});
  f = await finalise(db, STAT, id, {});
  assert.equal(f.ok, true, JSON.stringify(f));
  const d = await getAnalysis(db, id);
  assert.equal(d.analysis.status, 'final'); assert.equal(d.analysis.finalisedBy, 'Jiki Benjamin');
  assert.match((await setCell(db, STAT, id, { metric: 'crossing', side: 'lobi', period: '1H', block: '2', delta: 1 }, {})).error, /Final/);
  assert.match((await setText(db, STAT, id, { field: 'overview', value: 'x' }, {})).error, /Final/);
  assert.match((await reopenAnalysis(db, STAT, id, {})).error, /Super Admin/);
  assert.equal((await reopenAnalysis(db, ADMIN, id, {})).ok, true);
  const { id: id2 } = await setup({ lineups: false, events: false });
  assert.ok((await finalise(db, STAT, id2, {})).checks.errors.some(e => /starters/.test(e)));
});

test('Excel: three sheets (grid, totals, match and line-up), Lobi Stars only unless the opponent is included', async () => {
  const { id } = await setup();
  const d = await getAnalysis(db, id);
  const sheets = bstSheets(d);
  assert.deepEqual(sheets.map(s => s.name), ['Grid', 'Totals', 'Match & line-up']);
  assert.equal(sheets[0].rows.length, 19, 'one row per metric');
  assert.equal(bstSheets(d, { includeOpponent: true })[0].rows.length, 38);
  const files = unzipSync(buildXlsx(sheets));
  assert.ok(files['xl/worksheets/sheet1.xml'] && strFromU8(files['xl/workbook.xml']).includes('Match &amp; line-up'));
  assert.ok(JSON.stringify(sheets).includes('Lobi Stars FC'), 'Lobi Stars branding');
});
