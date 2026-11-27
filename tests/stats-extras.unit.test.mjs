// Statistics Center free-tool improvements on an in-memory database: the public feed (published only, nothing
// private), the Google Sheets link (secret key; a new key switches the old one off), and the second check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { d1 } from './helpers/d1shim.mjs';
import { DEMO_ROSTER, DEMO_EVENT, DEMO_LINEUPS, DEMO_EVENTS } from './fixtures/stats-centre-demo.mjs';
import { createMatch, saveLineups, applyEvents, publish, setClock } from '../functions/api/_lib/statsCentreData.js';
import { publicFeed, makeSheetsKey, stopSheetsKey, sheetsCsv, secondCheck, secondCheckProblem } from '../functions/api/_lib/statsExtras.js';
import { setSxSetting } from '../functions/api/_lib/statsCentre.js';

const A = { id: 'sxu_a', loginId: 'Jiki01', fullName: 'Jiki Benjamin', canPublish: true };
const B = { id: 'sxu_b', loginId: 'Second02', fullName: 'Second Person', canPublish: true };
const db = d1();
db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, ''));
let n = 0;
async function recorded() {
  const ev = `ex_ev_${++n}`;
  await db.prepare(`INSERT INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0)`)
    .bind(ev, DEMO_EVENT.home_team, DEMO_EVENT.away_team, DEMO_EVENT.competition, DEMO_EVENT.event_date, DEMO_EVENT.venue).run();
  const { id } = await createMatch(db, A, { eventId: ev }, {});
  await saveLineups(db, A, id, { home: DEMO_LINEUPS.home.map((p, i) => ({ ...p, rating: i === 0 ? 9.5 : null })), away: DEMO_LINEUPS.away }, DEMO_ROSTER);
  await applyEvents(db, A, id, DEMO_EVENTS.map(e => ({ op: 'save', event: { ...e, id: `${id.slice(-6)}${e.id}`, notes: 'staff only note' } })), DEMO_ROSTER);
  await setClock(db, A, id, { action: 'full_time' }, {});
  return id;
}

test('public feed: published matches only, leaders and team stats, nothing private', async () => {
  const id = await recorded();
  let f = await publicFeed(db, '2026/27');
  assert.equal(f.matches.length, 0, 'drafts are not in the feed');
  await publish(db, A, id, {});
  f = await publicFeed(db, '2026/27');
  assert.equal(f.matches.length, 1); assert.deepEqual(f.matches[0].score, [3, 1]);
  assert.equal(f.record.won, 1); assert.equal(f.topScorers.length, 2);
  const text = JSON.stringify(f);
  assert.ok(!/9\.5|staff only note|Jiki|rating|notes/i.test(text), 'no ratings, notes or staff names');
});

test('Google Sheets link: only the current key works; switching off stops it', async () => {
  assert.equal(await sheetsCsv(db, 'x'.repeat(30), '2026/27'), null);
  const { key } = await makeSheetsKey(db, A, {});
  const csv = await sheetsCsv(db, key, '2026/27');
  assert.ok(csv && csv.split('\r\n').length > 20);
  const { key: key2 } = await makeSheetsKey(db, A, {});
  assert.equal(await sheetsCsv(db, key, '2026/27'), null, 'the old link stops working');
  assert.ok(await sheetsCsv(db, key2, '2026/27'));
  await stopSheetsKey(db, A, {});
  assert.equal(await sheetsCsv(db, key2, '2026/27'), null);
});

test('second check: off by default; when on, someone other than the publisher must check first', async () => {
  const id = await recorded();
  assert.equal(await secondCheckProblem(db, A, id), null, 'off by default');
  await setSxSetting(db, 'second_check', '1', 'test');
  assert.match(await secondCheckProblem(db, A, id), /second person/);
  await secondCheck(db, A, id, {});
  assert.match(await secondCheckProblem(db, A, id), /someone other/, 'the checker cannot publish their own check');
  assert.equal(await secondCheckProblem(db, B, id), null, 'another person can publish');
  await setSxSetting(db, 'second_check', '0', 'test');
});
