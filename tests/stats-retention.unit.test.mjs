// Statistics Center data retention, archiving and privacy (statsRetention.js, statsPrivacy.js), on an in-memory
// database: seeded policies and the keep-forever guard, previews, dry-run first, the clean-up handlers (never match
// history), the activity log purge, season archive with checksum and read only, youth players hidden from public
// output, anonymising, notes left out of exports, and the backup rotation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { d1 } from './helpers/d1shim.mjs';
import { DEMO_ROSTER, DEMO_EVENT, DEMO_LINEUPS, DEMO_EVENTS } from './fixtures/stats-centre-demo.mjs';
import { createMatch, saveLineups, applyEvents, setClock, publish, publicMatch, playerMatchLog, eventsCsv, seasonExport } from '../functions/api/_lib/statsCentreData.js';
import { ensureStatsCentreSchema, setSxSetting } from '../functions/api/_lib/statsCentre.js';
import { publicFeed } from '../functions/api/_lib/statsExtras.js';
import { ensureRetentionSchema, policies, savePolicy, previewPolicy, runRetention, retentionState, setRetentionSwitch, archiveSeason, isSeasonArchived, verifyArchive, readFile,
  setPrivacy, anonymisePlayer, HANDLERS, backupsToDelete, seasonsList } from '../functions/api/_lib/statsRetention.js';

const SENIOR = { id: 'sxu_senior', loginId: 'Senior01', fullName: 'Senior Statistician', canPublish: true };
const ADMIN = { id: 'admin:1', loginId: 'owner@example.com', fullName: 'Owner', canPublish: true, admin: true };
const db = d1();
db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, ''));
const env = { DB: db };
const old = days => new Date(Date.now() - days * 864e5).toISOString();
let n = 0;
async function published(date = DEMO_EVENT.event_date) {
  const ev = { ...DEMO_EVENT, id: `${DEMO_EVENT.id}_r${++n}`, event_date: date };
  await db.prepare(`INSERT INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0)`)
    .bind(ev.id, ev.home_team, ev.away_team, ev.competition, ev.event_date, ev.venue).run();
  await ensureStatsCentreSchema(db);
  const { id } = await createMatch(db, SENIOR, { eventId: ev.id }, { startMonth: 8 });
  await saveLineups(db, SENIOR, id, DEMO_LINEUPS, DEMO_ROSTER);
  await applyEvents(db, SENIOR, id, DEMO_EVENTS.map(e => ({ op: 'save', event: { ...e, id: `r${n}${e.id}`, notes: e.slug === 'demo-player-9' ? 'Coach: lazy pressing' : e.notes } })), DEMO_ROSTER);
  await setClock(db, SENIOR, id, { action: 'full_time' }, {});
  assert.equal((await publish(db, SENIOR, id, {})).ok, true);
  return { id, ev };
}

test('policies are seeded once; keep-forever data cannot get a deletion period; only a Super Admin changes them', async () => {
  await ensureRetentionSchema(db);
  const p = await policies(db);
  assert.equal(p.length, 19);
  assert.equal(p.find(x => x.key === 'core_match_data').forever, true);
  assert.match((await savePolicy(db, ADMIN, 'core_match_data', { days: 365, action: 'purge' })).error, /kept forever/);
  assert.match((await savePolicy(db, SENIOR, 'audit_log', { days: 400 })).error, /Super Admin/);
  assert.equal((await savePolicy(db, ADMIN, 'audit_log', { days: 1200, action: 'purge' })).ok, true);
  assert.equal((await policies(db)).find(x => x.key === 'audit_log').days, 1200);
  await savePolicy(db, ADMIN, 'audit_log', { days: 1095, action: 'purge' });
  assert.equal((await previewPolicy(db, 'core_match_data')).keep, true);
});

test('the first 7 days are a dry run: counted, nothing removed; live after that, never match history', async () => {
  const { id } = await published();
  // An old draft analysis, an old presence row, an expired share link, old activity.
  await db.prepare(`INSERT INTO sx_bst_analyses (id, match_id, status, created_at, updated_at) VALUES ('bst_old', 'm_none_1', 'draft', ?, ?)`).bind(old(800), old(800)).run();
  await db.prepare(`INSERT INTO sx_bst_analyses (id, match_id, status, created_at, updated_at) VALUES ('bst_final_old', 'm_none_2', 'final', ?, ?)`).bind(old(2000), old(2000)).run();
  await db.prepare(`INSERT INTO sx_bst_presence (analysis_id, user_id, name, last_seen) VALUES ('x', 'u', 'U', ?)`).bind(old(30)).run();
  await db.prepare(`INSERT INTO sx_share_links (id, analysis_id, token_hash, expires_at, created_at) VALUES ('sh1', 'x', 'h1', ?, ?)`).bind(old(60), old(70)).run();
  await db.prepare(`INSERT INTO sx_activity (at, actor_kind, action) VALUES (?, 'system', 'old_thing')`).bind(old(1200)).run();
  const st = await retentionState(db);
  assert.equal(st.dryRun, true);
  const dry = await runRetention(db, null);
  assert.equal(dry.mode, 'dry-run');
  assert.equal(dry.counts.bst_draft.wouldArchive, 1);
  assert.ok(dry.counts.audit_log.wouldPurge >= 1);
  assert.ok(await db.prepare(`SELECT 1 FROM sx_share_links WHERE id = 'sh1'`).first(), 'nothing removed in the dry run');
  // Paused: skipped (unless forced).
  await setRetentionSwitch(db, ADMIN, { paused: true });
  assert.equal((await runRetention(db, null)).skipped, true);
  await setRetentionSwitch(db, ADMIN, { paused: false, live: true });
  const live = await runRetention(db, null);
  assert.equal(live.mode, 'live');
  assert.equal(live.errors.length, 0, live.errors.join());
  assert.equal((await db.prepare(`SELECT archived_at FROM sx_bst_analyses WHERE id = 'bst_old'`).first()).archived_at !== null, true, 'draft archived first');
  assert.ok(await db.prepare(`SELECT 1 FROM sx_bst_analyses WHERE id = 'bst_final_old'`).first(), 'Final analyses are kept forever');
  assert.equal(await db.prepare(`SELECT 1 FROM sx_share_links WHERE id = 'sh1'`).first(), null);
  assert.equal(await db.prepare(`SELECT 1 FROM sx_bst_presence WHERE analysis_id = 'x'`).first(), null);
  assert.equal(await db.prepare(`SELECT 1 FROM sx_activity WHERE action = 'old_thing'`).first(), null, 'old log rows purged');
  await assert.rejects(db.prepare(`DELETE FROM sx_activity`).run(), /cannot be deleted/, 'the log guard is back');
  assert.ok((await db.prepare(`SELECT COUNT(*) n FROM sx_events WHERE match_id = ?`).bind(id).first()).n > 10, 'match history untouched');
  // Running again changes nothing more (safe to repeat).
  const again = await runRetention(db, null);
  assert.equal(again.counts.share_links.purged || 0, 0);
});

test('archived drafts are deleted after a second period; old line-up history keeps the last version', async () => {
  await db.prepare(`UPDATE sx_bst_analyses SET archived_at = ? WHERE id = 'bst_old'`).bind(old(400)).run();
  const r = await HANDLERS.bst_draft(db, 365, true);
  assert.deepEqual(r.ids, ['bst_old']);
  await db.prepare(`INSERT INTO sx_lineup_revisions (id, sheet_id, version, snapshot_json, created_at) VALUES ('rv1', 'sh_x', 1, '{}', ?), ('rv2', 'sh_x', 2, '{}', ?), ('rv3', 'sh_x', 3, '{}', ?)`).bind(old(1500), old(1400), old(1300)).run();
  assert.equal((await HANDLERS.lineup_revisions(db, 1095, false)).wouldPurge, 2);
  await HANDLERS.lineup_revisions(db, 1095, true);
  assert.deepEqual((await db.prepare(`SELECT id FROM sx_lineup_revisions WHERE sheet_id = 'sh_x'`).all()).results.map(x => x.id), ['rv3']);
});

test('personal notes: cleared after the period, sooner for youth players and when a player leaves; numbers kept', async () => {
  const { id } = await published();
  await db.prepare(`UPDATE sx_lineups SET rating_note = 'Good shape' WHERE match_id = ? AND player_slug = 'demo-player-9'`).bind(id).run();
  assert.equal((await HANDLERS.personal_notes(db, 1095, false)).wouldAnonymise, 0, 'recent notes stay');
  await setPrivacy(db, ADMIN, 'demo-player-9', { youth: false, youthPublic: false, leftAt: '2026-01-01' });
  const r = await HANDLERS.personal_notes(db, 1095, true);
  assert.ok(r.anonymised >= 2);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM sx_events WHERE player_slug = 'demo-player-9' AND notes IS NOT NULL`).first()).n, 0);
  assert.equal((await db.prepare(`SELECT rating_note FROM sx_lineups WHERE match_id = ? AND player_slug = 'demo-player-9'`).bind(id).first()).rating_note, null);
  assert.ok((await db.prepare(`SELECT COUNT(*) n FROM sx_events WHERE player_slug = 'demo-player-9' AND event_type = 'goal'`).first()).n >= 1, 'goals kept');
  await setPrivacy(db, ADMIN, 'demo-player-9', { youth: false, youthPublic: false, leftAt: '' });
});

test('youth players are unnamed on public pages, the feed and their player page unless the club publishes them', async () => {
  const { ev } = await published();
  await setPrivacy(db, ADMIN, 'demo-player-9', { youth: true, youthPublic: false, leftAt: '' });
  const slug = (await db.prepare(`SELECT id FROM sx_matches WHERE event_id = ?`).bind(ev.id).first()).id;
  const pm = await publicMatch(db, slug);
  assert.ok(!JSON.stringify(pm).includes('demo-player-9'), 'not named on the public match page');
  assert.ok(JSON.stringify(pm).includes('Academy player'));
  assert.ok(!JSON.stringify(pm).includes('lazy pressing'), 'notes never public');
  const feed = await publicFeed(db, '2026/27');
  assert.ok(!JSON.stringify(feed).includes('demo-player-9'));
  assert.deepEqual(await playerMatchLog(db, ['demo-player-9'], '2026/27'), []);
  await setPrivacy(db, ADMIN, 'demo-player-9', { youth: true, youthPublic: true, leftAt: '' });
  assert.ok(JSON.stringify(await publicMatch(db, slug)).includes('demo-player-9'), 'shown once the club allows it');
  await setPrivacy(db, ADMIN, 'demo-player-9', { youth: false, youthPublic: false, leftAt: '' });
});

test('exports leave out personal notes unless "Include staff notes"', async () => {
  const { id } = await published();
  assert.ok(!(await eventsCsv(db, { matchId: id })).includes('lazy pressing'));
  assert.ok((await eventsCsv(db, { matchId: id, includeNotes: true })).includes('lazy pressing'));
  const ex = await seasonExport(db, '2026/27');
  assert.ok(!JSON.stringify(ex).includes('lazy pressing'));
});

test('anonymising a player: Super Admin, a reason, notes removed for good, optional "Former player"', async () => {
  const { id } = await published();
  assert.match((await anonymisePlayer(db, SENIOR, 'demo-player-9', { reason: 'Request' })).error, /Super Admin/);
  assert.match((await anonymisePlayer(db, ADMIN, 'demo-player-9', { reason: '' })).error, /reason/);
  const r = await anonymisePlayer(db, ADMIN, 'demo-player-9', { reason: 'Player asked', full: true });
  assert.ok(r.notes >= 1);
  assert.equal((await db.prepare(`SELECT player_name FROM sx_lineups WHERE match_id = ? AND player_slug = 'demo-player-9'`).bind(id).first()).player_name, 'Former player #9');
  assert.ok((await db.prepare(`SELECT details FROM sx_activity WHERE action = 'anonymise_player' ORDER BY id DESC`).first()).details.includes('Player asked'));
});

test('archiving a season: files with a checksum, read only, nothing deleted; verify spots damage', async () => {
  const before = (await db.prepare(`SELECT COUNT(*) n FROM sx_events`).first()).n;
  assert.match((await archiveSeason(env, SENIOR, '2026/27')).error, /Super Admin/);
  const r = await archiveSeason(env, ADMIN, '2026/27');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.files.length, 3);
  assert.equal(await isSeasonArchived(db, '2026/27'), true);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM sx_events`).first()).n, before, 'nothing deleted');
  const list = await seasonsList(db, 8);
  const s = list.find(x => x.season === '2026/27');
  assert.equal(s.status, 'archived');
  const json = s.exports.find(e => e.path.endsWith('season.json'));
  assert.ok(JSON.parse(await readFile(env, json.path)).matches.length >= 1);
  assert.equal((await verifyArchive(env, ADMIN, json.id)).matches, true);
  await db.prepare(`UPDATE sx_archive_files SET body = body || 'x' WHERE path = ?`).bind(json.path).run();
  assert.equal((await verifyArchive(env, ADMIN, json.id)).matches, false);
});

test('backups: daily for 30 days, weekly to 90, monthly to 365, then deleted', () => {
  const days = [];
  for (let i = 0; i < 400; i++) days.push(new Date(Date.parse('2026-11-27T00:00:00Z') - i * 864e5).toISOString().slice(0, 10));
  const del = new Set(backupsToDelete(days, '2026-11-27'));
  const kept = days.filter(d => !del.has(d));
  const age = d => (Date.parse('2026-11-27') - Date.parse(d)) / 864e5;
  assert.equal(kept.filter(d => age(d) <= 30).length, 31);
  const weekly = kept.filter(d => age(d) > 30 && age(d) <= 90).length;
  assert.ok(weekly >= 8 && weekly <= 10, `weekly ${weekly}`);
  const monthly = kept.filter(d => age(d) > 90 && age(d) <= 365).length;
  assert.ok(monthly >= 9 && monthly <= 11, `monthly ${monthly}`);
  assert.equal(kept.filter(d => age(d) > 365).length, 0);
});

test('setting: install date is recorded so the dry run ends after 7 days', async () => {
  await setSxSetting(db, 'retention_live', '0', 'test');
  await setSxSetting(db, 'retention_installed_at', old(8), 'test');
  assert.equal((await retentionState(db)).dryRun, false);
});
