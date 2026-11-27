// One shared line-up for the Media Centre's Matchday Desk and the Statistics Center (lineupService.js), on an
// in-memory database: merging, conflicts, validation, two saves at the same moment, confirm / reopen / lock,
// corrections with a reason, history and restore, presence and the pen, the one-time copy of the Media Centre's
// line-ups, and publishing from the shared line-up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { d1 } from './helpers/d1shim.mjs';
import { DEMO_ROSTER, DEMO_EVENT } from './fixtures/stats-centre-demo.mjs';
import { getSheet, applyChanges, confirmSheet, reopenSheet, revisions, restoreRevision, heartbeat, takePen, matchForEvent, migrateMediaLineups, sheetVersion } from '../functions/api/_lib/lineupService.js';
import { getMatch, setClock } from '../functions/api/_lib/statsCentreData.js';
import { ensureMediaSchema } from '../functions/api/_lib/mediaCentre.js';
import { ensureTable as ensureMatchCentre } from '../functions/api/_lib/matchCentre.js';
import { LINEUP } from '../functions/api/_lib/mediaMatchday.js';

const STAT = { kind: 'stats', id: 'sxu_j', fullName: 'Jiki Benjamin', loginId: 'Jiki01' };
const MEDIA = { kind: 'media', id: 'mcu_m', fullName: 'Media Officer', loginId: 'Media01' };
const ADMIN = { kind: 'admin', id: 'admin:1', fullName: 'Owner', loginId: 'owner@example.com' };
const db = d1();
db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, ''));
let n = 0;
async function fixture(date = '2099-01-01T15:00:00Z') {
  const ev = `lu_ev_${++n}`;
  await db.prepare(`INSERT INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo) VALUES (?, 'Lobi Stars FC', 'Demo United FC', 'NNL', ?, 'McCarthy Stadium', 0, 0, 0)`).bind(ev, date).run();
  return { ev, matchId: await matchForEvent(db, MEDIA, ev) };
}
const set = (i, role = 'starter', extra = {}) => ({ op: 'set', slug: DEMO_ROSTER[i].slug, role, ...extra });

test('one match for both pages; one sheet per team, even when created at the same moment', async () => {
  const { ev, matchId } = await fixture();
  assert.equal(await matchForEvent(db, STAT, ev), matchId, 'the Statistics Center finds the same match');
  const [a, b] = await Promise.all([getSheet(db, matchId, 'home', STAT), getSheet(db, matchId, 'home', MEDIA)]);
  assert.equal(a.sheetId, b.sheetId);
  assert.equal((await db.prepare(`SELECT COUNT(*) AS c FROM sx_lineup_sheets WHERE match_id = ?`).bind(matchId).first()).c, 1);
});

test('different players merge; the same player is a conflict with "what changed"; nothing is half-saved', async () => {
  const { matchId } = await fixture();
  const r0 = await applyChanges(db, MEDIA, matchId, 'home', 0, [set(0), set(1)], DEMO_ROSTER);
  assert.equal(r0.ok, true); const v = r0.sheet.version;
  // Jiki (Statistics Center) and the media officer both start from version v.
  const a = await applyChanges(db, STAT, matchId, 'home', v, [set(2)], DEMO_ROSTER);
  const b = await applyChanges(db, MEDIA, matchId, 'home', v, [set(3, 'sub')], DEMO_ROSTER);
  assert.equal(a.ok, true); assert.equal(b.ok, true); assert.equal(b.merged, true, 'merged automatically');
  assert.deepEqual(b.sheet.rows.map(r => r.slug).sort(), ['demo-player-1', 'demo-player-2', 'demo-player-3', 'demo-player-4']);
  const before = await sheetVersion(db, matchId, 'home');
  const c = await applyChanges(db, STAT, matchId, 'home', v, [set(3, 'starter'), set(4)], DEMO_ROSTER);
  assert.equal(c.conflict, true); assert.equal(c.status, 409);
  assert.equal(c.conflicts[0].label, 'Demo Stopper'); assert.ok(c.changedSince.some(x => /Media Officer/.test(x.by)));
  assert.equal((await sheetVersion(db, matchId, 'home')).version, before.version, 'no partial write (Demo Leftback not added)');
});

test('validation: 12th starter, shirt number clash, player not in the squad, bad formation', async () => {
  const { matchId } = await fixture();
  const r = await applyChanges(db, STAT, matchId, 'home', 0, Array.from({ length: 11 }, (_, i) => set(i)), DEMO_ROSTER);
  assert.equal(r.ok, true);
  assert.match((await applyChanges(db, STAT, matchId, 'home', r.sheet.version, [set(11)], DEMO_ROSTER)).error, /only 11/);
  assert.match((await applyChanges(db, STAT, matchId, 'home', r.sheet.version, [set(11, 'sub', { number: 9 })], DEMO_ROSTER)).error, /Shirt number 9/);
  assert.match((await applyChanges(db, STAT, matchId, 'home', r.sheet.version, [{ op: 'set', slug: 'nobody', role: 'sub' }], DEMO_ROSTER)).error, /squad/);
  assert.match((await applyChanges(db, STAT, matchId, 'home', r.sheet.version, [{ op: 'formation', value: '4-4-4-4-4-4' }], DEMO_ROSTER)).error, /formation/);
  // opponents: same name twice
  assert.match((await applyChanges(db, STAT, matchId, 'away', 0, [{ op: 'set', name: 'A Player', number: 4, role: 'starter' }, { op: 'set', name: 'A Player', number: 5, role: 'starter' }], DEMO_ROSTER)).error, /twice/);
});

test('two saves at the same moment: both kept (no lost update), versions in order', async () => {
  const { matchId } = await fixture();
  const results = await Promise.all([applyChanges(db, STAT, matchId, 'home', 0, [set(0)], DEMO_ROSTER), applyChanges(db, MEDIA, matchId, 'home', 0, [set(5, 'sub')], DEMO_ROSTER)]);
  assert.ok(results.every(r => r.ok));
  const s = await getSheet(db, matchId, 'home');
  assert.equal(s.rows.length, 2); assert.equal(s.version, 2);
  assert.equal((await revisions(db, matchId, 'home')).length, 2);
});

test('confirm, reopen, lock at kick-off, correction with a reason (audited)', async () => {
  const { matchId } = await fixture();
  const r = await applyChanges(db, MEDIA, matchId, 'home', 0, Array.from({ length: 11 }, (_, i) => set(i)), DEMO_ROSTER);
  assert.equal((await confirmSheet(db, MEDIA, matchId, 'home')).ok, true);
  const blocked = await applyChanges(db, STAT, matchId, 'home', r.sheet.version + 1, [set(11, 'sub')], DEMO_ROSTER);
  assert.match(blocked.error, /confirmed by Media Officer/); assert.equal(blocked.confirmed, true);
  const re = await reopenSheet(db, STAT, matchId, 'home');
  assert.equal(re.sheet.status, 'draft');
  await confirmSheet(db, STAT, matchId, 'home');
  await setClock(db, { id: 'sxu_j', loginId: 'Jiki01', fullName: 'Jiki Benjamin' }, matchId, { action: 'start_1h' }, {});
  const s = await getSheet(db, matchId, 'home');
  assert.equal(s.status, 'locked', 'kick-off locks the line-up');
  assert.match((await applyChanges(db, MEDIA, matchId, 'home', s.version, [set(0, 'starter', { number: 30 })], DEMO_ROSTER)).error, /locked/);
  assert.match((await applyChanges(db, STAT, matchId, 'home', s.version, [set(0, 'starter', { number: 30 })], DEMO_ROSTER)).error, /locked/, 'a reason is needed');
  const fix = await applyChanges(db, STAT, matchId, 'home', s.version, [set(0, 'starter', { number: 30 })], DEMO_ROSTER, { reason: 'wrong shirt number on the team sheet' });
  assert.equal(fix.ok, true);
  const log = (await db.prepare(`SELECT details FROM sx_activity WHERE action = 'lineup_correction' ORDER BY id DESC LIMIT 1`).first()).details;
  assert.match(log, /wrong shirt number/);
});

test('kick-off time passing locks too; history is kept and an old version can be restored as a new one', async () => {
  const { matchId } = await fixture('2020-01-01T15:00:00Z');
  const s0 = await getSheet(db, matchId, 'home');
  assert.equal(s0.status, 'locked', 'the kick-off time has passed');
  const { matchId: m2 } = await fixture();
  const a = await applyChanges(db, STAT, m2, 'home', 0, [set(0), set(1)], DEMO_ROSTER);
  await applyChanges(db, STAT, m2, 'home', a.sheet.version, [set(1, 'none'), set(2, 'sub')], DEMO_ROSTER);
  const revs = await revisions(db, m2, 'home');
  const first = revs.find(r => r.version === 1);
  const back = await restoreRevision(db, ADMIN, m2, 'home', first.id, DEMO_ROSTER);
  assert.equal(back.ok, true);
  assert.deepEqual(back.sheet.rows.map(r => r.slug).sort(), ['demo-player-1', 'demo-player-2']);
  assert.equal((await revisions(db, m2, 'home')).length, 3, 'restoring adds a version, nothing deleted');
});

test('presence appears and expires; the pen makes it read only for others; a Super Admin can override', async () => {
  const { matchId } = await fixture();
  await heartbeat(db, MEDIA, matchId, 'home', 'media-matchday');
  let s = await getSheet(db, matchId, 'home', STAT);
  assert.equal(s.others[0].name, 'Media Officer (Media Centre)');
  await db.prepare(`UPDATE sx_lineup_presence SET last_heartbeat = ?`).bind(new Date(Date.now() - 60e3).toISOString()).run();
  s = await getSheet(db, matchId, 'home', STAT);
  assert.equal(s.others.length, 0, 'gone after 45 seconds');
  assert.equal((await takePen(db, MEDIA, matchId, 'home')).ok, true);
  assert.match((await applyChanges(db, STAT, matchId, 'home', 0, [set(0)], DEMO_ROSTER)).error, /has the pen/);
  assert.equal((await applyChanges(db, MEDIA, matchId, 'home', 0, [set(0)], DEMO_ROSTER)).ok, true);
  assert.match((await takePen(db, STAT, matchId, 'home')).error, /has the pen/);
  assert.equal((await takePen(db, ADMIN, matchId, 'home', { override: true })).ok, true);
});

test('the Media Centre line-ups are copied once (safe to run again), with a report; publishing reads the shared line-up', async () => {
  await ensureMediaSchema(db); await ensureMatchCentre(db);
  const { ev } = await (async () => { const ev2 = `lu_ev_mig_${++n}`; await db.prepare(`INSERT INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo) VALUES (?, 'Lobi Stars FC', 'Old FC', 'NNL', '2099-02-01T15:00:00Z', 'McCarthy Stadium', 0, 0, 0)`).bind(ev2).run(); return { ev: ev2 }; })();
  const data = { eventId: ev, starting: DEMO_ROSTER.slice(0, 11).map(p => ({ slug: p.slug, name: p.name, number: p.number })), subs: [{ slug: 'gone-player', name: 'Gone Player', number: 40 }], formation: '4-3-3' };
  await db.prepare(`INSERT INTO mc_items (id, kind, status, title, data_json, live_json, ref, created_at, updated_at) VALUES ('mci_mig', 'lineup', 'published', 'Line-up', ?, ?, ?, '2026-11-20T10:00:00Z', '2026-11-20T10:00:00Z')`).bind(JSON.stringify(data), JSON.stringify(data), ev).run();
  const rep = await migrateMediaLineups(db, DEMO_ROSTER, { force: true });
  assert.ok(rep.migrated >= 1); assert.ok(rep.unmatched.some(u => /Gone Player/.test(u.reason)), 'unmatched players are reported');
  const again = await migrateMediaLineups(db, DEMO_ROSTER, { force: true });
  assert.equal(again.migrated, 0, 'running again copies nothing new'); assert.ok(again.skippedHasLineup >= 1);
  const mid = await matchForEvent(db, MEDIA, ev);
  const sheet = await getSheet(db, mid, 'home');
  assert.equal(sheet.rows.filter(r => r.role === 'starter').length, 11); assert.equal(sheet.status, 'confirmed', 'already published: confirmed'); assert.equal(sheet.formation, '4-3-3');
  // A change in the Statistics Center, then the Media Centre publishes: the match page gets the shared line-up.
  await reopenSheet(db, STAT, mid, 'home');
  const s2 = await getSheet(db, mid, 'home');
  await applyChanges(db, STAT, mid, 'home', s2.version, [set(0, 'none'), set(12)], DEMO_ROSTER);
  const res = await LINEUP.publish({ DB: db }, {}, { eventId: ev, starting: [], subs: [] });
  assert.equal(res.ok, true);
  const mc = await db.prepare(`SELECT lineups_json, squad_json FROM match_centre WHERE event_id = ?`).bind(ev).first();
  const lu = JSON.parse(mc.lineups_json).home;
  assert.ok(lu.starting.includes('Demo Subdefender') && !lu.starting.includes('Demo Keeper'), 'published from the shared line-up');
  const after = await getSheet(db, mid, 'home');
  assert.ok(after.publishedAt); assert.equal(after.changedSincePublished, false);
  await applyChanges(db, STAT, mid, 'home', after.version, [set(13, 'sub')], DEMO_ROSTER);
  assert.equal((await getSheet(db, mid, 'home')).changedSincePublished, true, 'changed since the last publication');
  assert.ok((await getMatch(db, mid)).lineups.some(l => l.slug === 'demo-player-14'), 'Statistics Center sees the same rows');
});
