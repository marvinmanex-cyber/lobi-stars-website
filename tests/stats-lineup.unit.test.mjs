// Statistics Center › Match Setup line-up: filled from the Media Centre's Matchday Desk line-up for the same fixture
// (or the line-up already on the match page), read only. And the player pages get only public figures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { d1 } from './helpers/d1shim.mjs';
import { DEMO_ROSTER, DEMO_EVENT, DEMO_LINEUPS, DEMO_EVENTS } from './fixtures/stats-centre-demo.mjs';
import { createMatch, mediaLineup, saveLineups, applyEvents, publish, playerMatchLog } from '../functions/api/_lib/statsCentreData.js';
import { ensureMediaSchema } from '../functions/api/_lib/mediaCentre.js';
import { ensureTable as ensureMatchCentre } from '../functions/api/_lib/matchCentre.js';

const U = { id: 'sxu_j', loginId: 'Jiki01', fullName: 'Jiki Benjamin', canPublish: true };
const db = d1();
db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, ''));
let n = 0;
async function fixture() {
  const ev = { ...DEMO_EVENT, id: `lu_ev_${++n}` };
  await db.prepare(`INSERT INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0)`)
    .bind(ev.id, ev.home_team, ev.away_team, ev.competition, ev.event_date, ev.venue).run();
  return { ev, id: (await createMatch(db, U, { eventId: ev.id }, {})).id };
}

test('the Media Centre line-up for the same fixture fills the picker (published before draft); nothing written there', async () => {
  await ensureMediaSchema(db);
  const { ev, id } = await fixture();
  assert.equal(await mediaLineup(db, id), null, 'none yet');
  const data = { eventId: ev.id, starting: DEMO_ROSTER.slice(0, 11).map(p => ({ slug: p.slug, name: p.name, number: p.number })), subs: DEMO_ROSTER.slice(11, 14).map(p => ({ slug: p.slug, name: p.name, number: p.number })), formation: '4-3-3' };
  await db.prepare(`INSERT INTO mc_items (id, kind, status, title, data_json, ref, created_at, updated_at, updated_by_name) VALUES ('mci_1', 'lineup', 'draft', 'Line-up', ?, ?, '2026-11-27T10:00:00Z', '2026-11-27T10:00:00Z', 'Media Officer')`)
    .bind(JSON.stringify(data), ev.id).run();
  const before = (await db.prepare(`SELECT COUNT(*) AS c FROM mc_items`).first()).c;
  const L = await mediaLineup(db, id);
  assert.equal(L.source, 'media'); assert.equal(L.status, 'draft'); assert.equal(L.starting.length, 11); assert.equal(L.subs.length, 3); assert.equal(L.formation, '4-3-3'); assert.equal(L.by, 'Media Officer');
  assert.equal((await db.prepare(`SELECT COUNT(*) AS c FROM mc_items`).first()).c, before, 'read only');
  // A friendly that is not in the fixtures has no Media Centre line-up.
  const { id: friendly } = await createMatch(db, U, { home: 'Lobi Stars FC', away: 'Friendly FC', date: '2026-12-01' }, {});
  assert.equal(await mediaLineup(db, friendly), null);
});

test('without a Media Centre line-up, the one on the match page is offered', async () => {
  await ensureMatchCentre(db);
  const { ev, id } = await fixture();
  await db.prepare(`INSERT INTO match_centre (event_id, status, squad_json) VALUES (?, 'scheduled', ?)`).bind(ev.id, JSON.stringify({ starting: [{ slug: 'demo-player-1', name: 'Demo Keeper', number: 1 }], bench: [] })).run();
  const L = await mediaLineup(db, id);
  assert.equal(L.source, 'match'); assert.equal(L.starting[0].slug, 'demo-player-1');
});

test('player pages get only public figures from published matches (no ratings, notes or staff names)', async () => {
  const { id } = await fixture();
  await saveLineups(db, U, id, { home: DEMO_LINEUPS.home.map((p, i) => ({ ...p, rating: i === 8 ? 8.5 : null })), away: DEMO_LINEUPS.away }, DEMO_ROSTER);
  await applyEvents(db, U, id, DEMO_EVENTS.map(e => ({ op: 'save', event: { ...e, id: `${id.slice(-6)}${e.id}`, notes: 'private note' } })), DEMO_ROSTER);
  assert.deepEqual(await playerMatchLog(db, ['demo-player-9'], '2026/27'), [], 'nothing before publishing');
  await publish(db, U, id, {});
  const log = await playerMatchLog(db, ['demo-player-9'], '2026/27');
  assert.equal(log.length, 1);
  assert.deepEqual(Object.keys(log[0]).sort(), ['assists', 'date', 'goals', 'home', 'minutes', 'opponent', 'red', 'score', 'started', 'url', 'yellow']);
  assert.equal(log[0].goals, 1); assert.match(log[0].url, /^\/stats\/matches\//);
  assert.ok(!JSON.stringify(log).match(/8\.5|private note|Jiki/), 'no rating, note or staff name');
});
