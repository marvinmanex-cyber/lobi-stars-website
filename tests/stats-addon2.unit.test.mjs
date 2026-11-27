// Statistics Center Add-on 2 on an in-memory database: the opponent registry (saved once, reused next match, copy the
// last line-up), duplicate warnings, Lobi/Opponent grid from the same events, tagging players without new events,
// the data quality panel, coach share links (expiry, switch off, notes left out), the recycle bin, the season export.
// Seed: one opponent club with 14 saved players.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { d1 } from './helpers/d1shim.mjs';
import { DEMO_ROSTER, DEMO_LINEUPS } from './fixtures/stats-centre-demo.mjs';
import { createMatch, saveLineups, applyEvents, getMatch, removeMatch, opponentPlayers, lastOpponentLineup, recycleBin, restoreItem, removeAnalysis, seasonExport, teamKey } from '../functions/api/_lib/statsCentreData.js';
import { createAnalysis, getAnalysis, setText, createShare, listShares, revokeShare, sharedAnalysis } from '../functions/api/_lib/statsBst.js';

const U = { id: 'sxu_j', loginId: 'Jiki01', fullName: 'Jiki Benjamin', canPublish: true };
const db = d1();
db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, ''));
const OPP = 'Demo United FC';
const OPP14 = Array.from({ length: 14 }, (_, i) => ({ name: `Visitor ${i + 1}`, number: i + 1, position: i === 0 ? 'GK' : '', starter: i < 11 }));
let n = 0;
async function match(date, away = OPP) {
  const ev = `a2_ev_${++n}`;
  await db.prepare(`INSERT INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo) VALUES (?, 'Lobi Stars FC', ?, 'NNL', ?, 'McCarthy Stadium', 0, 0, 0)`).bind(ev, away, date).run();
  return (await createMatch(db, U, { eventId: ev }, {})).id;
}

test('opponent players are saved once per club and offered next time; the last line-up can be copied', async () => {
  assert.equal(teamKey('Wikki Tourists F.C.'), teamKey('Wikki Tourists FC'));
  const first = await match('2026-09-01T15:00:00Z');
  await saveLineups(db, U, first, { home: DEMO_LINEUPS.home, away: OPP14 }, DEMO_ROSTER);
  let saved = await opponentPlayers(db, 'Demo United F.C.');
  assert.equal(saved.length, 14, 'seed: 14 saved players');
  const second = await match('2026-10-01T15:00:00Z');
  const last = await lastOpponentLineup(db, second);
  assert.equal(last.players.length, 14); assert.equal(last.players.filter(p => p.starter).length, 11);
  // Used again with one new player: no duplicates in the registry, one more saved.
  await saveLineups(db, U, second, { home: DEMO_LINEUPS.home, away: [...OPP14.slice(0, 13), { name: 'New Striker', number: 30, starter: false }] }, DEMO_ROSTER);
  saved = await opponentPlayers(db, OPP);
  assert.equal(saved.length, 15);
  const lu = (await getMatch(db, second)).lineups.filter(l => l.side === 'away');
  const linked = (await db.prepare(`SELECT COUNT(*) AS c FROM sx_lineups WHERE match_id = ? AND opponent_player_id IS NOT NULL`).bind(second).first()).c;
  assert.equal(linked, lu.length, 'every opponent row is linked to the registry');
});

test('duplicate warnings: same player twice, same shirt number twice', async () => {
  const id = await match('2026-11-01T15:00:00Z', 'Warning FC');
  const r = await saveLineups(db, U, id, { home: [...DEMO_LINEUPS.home.slice(0, 11), { slug: 'demo-player-12', number: 9, starter: false }], away: [{ name: 'A Player', number: 4, starter: true }, { name: 'A Player', number: 4, starter: true }, { name: 'B Player', number: 4, starter: true }] }, DEMO_ROSTER);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some(w => /listed twice/.test(w)));
  assert.ok(r.warnings.some(w => /shirt number 9/.test(w)), 'Lobi: number 9 twice');
  assert.ok(r.warnings.some(w => /shirt number 4/.test(w)), 'opponent: number 4 twice');
});

test('opponent events show in the opponent grid; tagging a player edits the event (no new event)', async () => {
  const id = await match('2026-11-05T15:00:00Z');
  await saveLineups(db, U, id, { home: DEMO_LINEUPS.home, away: OPP14 }, DEMO_ROSTER);
  await applyEvents(db, U, id, [{ op: 'save', event: { id: 'a2opp000001', side: 'away', type: 'corner', period: '1H', minute: 9 } }, { op: 'save', event: { id: 'a2opp000002', side: 'home', type: 'shot', outcome: 'off_target', period: '1H', minute: 9 } }], DEMO_ROSTER);
  const { id: aid } = await createAnalysis(db, U, id, {});
  let d = await getAnalysis(db, aid);
  assert.equal(d.grid.opponent.corner['1H']['10'], 1); assert.equal(d.grid.lobi.corner['1H']['10'], 0); assert.equal(d.grid.lobi.shot_off['1H']['10'], 1);
  assert.ok(d.quality.some(q => /without a player/.test(q.text)));
  const e = (await getMatch(db, id)).events.find(x => x.id === 'a2opp000002');
  await applyEvents(db, U, id, [{ op: 'save', event: { ...e, slug: 'demo-player-9', name: 'Demo Striker' } }], DEMO_ROSTER);
  const m = await getMatch(db, id);
  assert.equal(m.events.length, 2, 'no new event');
  assert.equal(m.events.find(x => x.id === 'a2opp000002').slug, 'demo-player-9');
  assert.equal(m.derived.players.find(p => p.slug === 'demo-player-9').shots, 1, 'player stats follow');
  d = await getAnalysis(db, aid);
  assert.equal(d.grid.lobi.shot_off['1H']['10'], 1, 'still one in the grid');
});

test('coach share links: read only copy, notes left out unless asked, expiry and switch off', async () => {
  const id = await match('2026-11-06T15:00:00Z');
  await saveLineups(db, U, id, { home: DEMO_LINEUPS.home, away: OPP14 }, DEMO_ROSTER);
  const { id: aid } = await createAnalysis(db, U, id, {});
  await setText(db, U, aid, { field: 'half1Note', value: 'Private: number 6 carrying a knock.', baseText: '' }, {});
  const a = await createShare(db, U, aid, { days: 14 }, {});
  assert.match(a.token, /^[0-9a-f]{48}$/);
  let v = await sharedAnalysis(db, a.token);
  assert.equal(v.match.away, OPP); assert.equal(v.analysis.half1Note, '', 'staff notes left out');
  const b = await createShare(db, U, aid, { days: 1, includeNotes: true }, {});
  assert.match((await sharedAnalysis(db, b.token)).analysis.half1Note, /knock/);
  assert.equal(await sharedAnalysis(db, 'f'.repeat(48)), null, 'unknown link');
  await revokeShare(db, U, a.id, {});
  assert.equal(await sharedAnalysis(db, a.token), null, 'switched off');
  await db.prepare(`UPDATE sx_share_links SET expires_at = ? WHERE id = ?`).bind(new Date(Date.now() - 1000).toISOString(), b.id).run();
  assert.equal(await sharedAnalysis(db, b.token), null, 'expired');
  const list = await listShares(db, aid);
  assert.equal(list.length, 2); assert.ok(list.every(x => !x.active));
  assert.equal((await createShare(db, U, aid, { days: 99 }, {})).ok, true, 'days are capped at 30');
  assert.ok(Date.parse((await listShares(db, aid))[0].expiresAt) - Date.now() <= 30 * 864e5 + 5000);
});

test('recycle bin: removed matches, analyses and events are kept and can be restored', async () => {
  const id = await match('2026-11-07T15:00:00Z', 'Recycle FC');
  await applyEvents(db, U, id, [{ op: 'save', event: { id: 'a2rec000001', side: 'home', type: 'corner', period: '1H', minute: 3 } }, { op: 'delete', id: 'a2rec000001' }], DEMO_ROSTER);
  await applyEvents(db, U, id, [{ op: 'delete', id: 'a2rec000001' }], DEMO_ROSTER);
  const { id: aid } = await createAnalysis(db, U, id, {});
  await removeAnalysis(db, U, aid, {});
  await removeMatch(db, U, id, {});
  let bin = await recycleBin(db);
  assert.ok(bin.some(x => x.type === 'match' && x.id === id) && bin.some(x => x.type === 'analysis' && x.id === aid));
  assert.equal((await restoreItem(db, U, { type: 'match', id }, {})).ok, true);
  assert.equal((await restoreItem(db, U, { type: 'analysis', id: aid }, {})).ok, true);
  assert.equal((await restoreItem(db, U, { type: 'event', id: 'a2rec000001' }, {})).ok, true);
  assert.equal((await getMatch(db, id)).events.length, 1);
  bin = await recycleBin(db);
  assert.ok(!bin.some(x => x.id === id || x.id === aid));
  assert.match((await restoreItem(db, U, { type: 'nonsense', id: 'x' }, {})).error, /Unknown/);
});

test('season export has matches, line-ups, events and analyses (no published copies or clock)', async () => {
  const data = await seasonExport(db, '2026/27');
  assert.ok(data.matches.length >= 5); assert.ok(data.lineups.length > 0); assert.ok(data.events.length > 0); assert.ok(data.analyses.length > 0);
  assert.ok(!('published_json' in data.matches[0]) && !('clock_json' in data.matches[0]));
});
