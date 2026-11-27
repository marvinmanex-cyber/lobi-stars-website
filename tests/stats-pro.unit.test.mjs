// Statistics Center professional add-ons (statsPro.js and the core changes), on an in-memory database: passes and
// pass types, advanced numbers (expected points, game state, field tilt, PPDA), goalkeepers, availability with automatic
// suspensions, wellness links and load, development targets and radar, milestones, the public hub, reports,
// practice matches, versioned definitions and read-only coach accounts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { d1 } from './helpers/d1shim.mjs';
import { DEMO_ROSTER, DEMO_EVENT, DEMO_LINEUPS, DEMO_EVENTS } from './fixtures/stats-centre-demo.mjs';
import { createMatch, saveLineups, applyEvents, setClock, publish, getMatch, passFlags, publishedMatches, seasons, removeMatch } from '../functions/api/_lib/statsCentreData.js';
import { ensureStatsCentreSchema } from '../functions/api/_lib/statsCentre.js';
import { ensureProSchema, expectedPoints, matchAdvanced, seasonAdvanced, availability, setAvailability, autoSuspensions, makeWellnessLink, submitWellness, wellnessOverview, loadSummary,
  saveTarget, development, updateMilestones, milestones, publicHub, matchReportHtml, oppositionPackHtml, definitions, newDefinitionsVersion } from '../functions/api/_lib/statsPro.js';
import { setPrivacy } from '../functions/api/_lib/statsRetention.js';

const SENIOR = { id: 'sxu_senior', loginId: 'Senior01', fullName: 'Senior Statistician', canPublish: true };
const STATS = { id: 'sxu_stat', loginId: 'Jiki01', fullName: 'Jiki Benjamin', canPublish: false };
const ADMIN = { id: 'admin:1', loginId: 'owner@example.com', fullName: 'Owner', canPublish: true, admin: true };
const db = d1();
db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, ''));
let n = 0;
const PASSES = [
  { side: 'home', type: 'pass', minute: 10, period: '1H', slug: 'demo-player-6', relatedSlug: 'demo-player-8', outcome: 'complete', x: 30, y: 50, endX: 60, endY: 40 },
  { side: 'home', type: 'pass', minute: 11, period: '1H', slug: 'demo-player-8', relatedSlug: 'demo-player-9', outcome: 'complete', x: 60, y: 40, endX: 90, endY: 50 },
  { side: 'home', type: 'pass', minute: 12, period: '1H', slug: 'demo-player-1', outcome: 'incomplete', x: 5, y: 50, endX: 55, endY: 30 },
  { side: 'away', type: 'pass', minute: 20, period: '1H', name: 'Visitor 4', relatedName: 'Visitor 7', outcome: 'complete', x: 20, y: 50, endX: 30, endY: 50 },
  { side: 'away', type: 'pass', minute: 21, period: '1H', name: 'Visitor 7', outcome: 'complete', x: 35, y: 50, endX: 40, endY: 60 },
  { side: 'home', type: 'tackle', minute: 22, period: '1H', slug: 'demo-player-6', x: 55, y: 50 },
];
async function published({ passes = true } = {}) {
  const ev = { ...DEMO_EVENT, id: `${DEMO_EVENT.id}_p${++n}` };
  await db.prepare(`INSERT INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0)`)
    .bind(ev.id, ev.home_team, ev.away_team, ev.competition, ev.event_date, ev.venue).run();
  await ensureStatsCentreSchema(db); await ensureProSchema(db);
  const { id } = await createMatch(db, SENIOR, { eventId: ev.id }, { startMonth: 8 });
  await saveLineups(db, SENIOR, id, DEMO_LINEUPS, DEMO_ROSTER);
  const evs = [...DEMO_EVENTS, ...(passes ? PASSES.map((p, i) => ({ ...p, id: `pass${String(i).padStart(4, '0')}` })) : [])];
  const r = await applyEvents(db, SENIOR, id, evs.map(e => ({ op: 'save', event: { ...e, id: `p${n}${e.id}` } })), DEMO_ROSTER);
  assert.ok(r.results.every(x => x.ok), JSON.stringify(r.results.find(x => !x.ok)));
  await setClock(db, SENIOR, id, { action: 'full_time' }, {});
  assert.equal((await publish(db, SENIOR, id, {})).ok, true);
  return id;
}

test('passes: saved with end points; complete, progressive, final third and box worked out', async () => {
  assert.deepEqual(passFlags({ x: 60, y: 40, endX: 90, endY: 50 }), { progressive: true, finalThird: true, box: true });
  assert.equal(passFlags({ x: 20, y: 50, endX: 30, endY: 50 }).progressive, false);
  assert.equal(passFlags({ x: null, endX: null }).progressive, false);
  const id = await published();
  const full = await getMatch(db, id);
  const t = full.derived.team.home;
  assert.equal(t.passes, 3); assert.equal(t.passesComplete, 2); assert.equal(t.boxPasses, 1);
  assert.equal(full.events.find(e => e.type === 'pass').endX, 60);
  const p8 = full.derived.players.find(p => p.slug === 'demo-player-8');
  assert.equal(p8.passes, 1); assert.equal(p8.progressivePasses, 1);
});

test('advanced numbers: expected points, game state, field tilt, PPDA, shot quality, goalkeepers, pass network', async () => {
  const xp = expectedPoints([1, 1], [0]);
  assert.equal(xp.win, 1); assert.equal(xp.xPts, 3);
  const id = await published();
  const a = matchAdvanced(await getMatch(db, id));
  assert.ok(a.expected.xPts >= 0 && a.expected.xPts <= 3);
  assert.equal(a.expected.actualPoints, 3, 'Lobi Stars won 3–1');
  const gs = a.gameState, mins = gs.winning.minutes + gs.drawing.minutes + gs.losing.minutes;
  assert.equal(mins, 90);
  assert.equal(gs.winning.gf + gs.drawing.gf + gs.losing.gf, 3);
  assert.ok(a.fieldTilt && a.fieldTilt.lobi > 0);
  assert.ok(a.ppda && a.ppda.value > 0);
  assert.equal(a.passing.home.passes, 3);
  assert.ok(a.network.links.some(l => l.from === 'demo-player-8' && l.to === 'demo-player-9'));
  const gk = a.keepers.find(k => k.side === 'home');
  assert.ok(gk.keepers.length >= 1);
  assert.equal(gk.conceded, 1);
  assert.equal(gk.distribution.passes, 1);
  const s = await seasonAdvanced(db, '2026/27');
  assert.ok(s.matches >= 2); assert.ok(s.expected.points >= 6);
});

test('availability: set and clear; red cards and every Nth yellow suspend for the next match', async () => {
  assert.match((await setAvailability(db, STATS, { slug: 'demo-player-3', status: 'nonsense' })).error, /status/);
  await setAvailability(db, STATS, { slug: 'demo-player-3', status: 'injured', reason: 'Hamstring', expectedReturn: '2026-12-10' });
  let a = await availability(db, '2026/27');
  assert.equal(a.players['demo-player-3'].status, 'injured');
  await setAvailability(db, STATS, { slug: 'demo-player-3', status: 'available' });
  a = await availability(db, '2026/27');
  assert.equal(a.players['demo-player-3'], undefined);
  const snap = (evs) => ({ match: { lobiHome: true, home: 'Lobi Stars FC', away: 'X' }, events: evs });
  const r = autoSuspensions([snap([{ side: 'home', slug: 'p1', type: 'yellow_card' }]), snap([{ side: 'home', slug: 'p1', type: 'yellow_card' }, { side: 'home', slug: 'p2', type: 'red_card' }])], { yellowBan: 2 });
  assert.equal(r.suspended.get('p1').status, 'suspended');
  assert.equal(r.suspended.get('p2').status, 'suspended');
  const older = autoSuspensions([snap([{ side: 'home', slug: 'p2', type: 'red_card' }]), snap([])]);
  assert.equal(older.suspended.size, 0, 'the ban was served by the next match');
});

test('wellness: a private link, entries from the phone, load ratio and alerts; a new link stops the old one', async () => {
  const { token } = await makeWellnessLink(db, STATS, 'demo-player-5');
  const today = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
  assert.equal((await submitWellness(db, 'x'.repeat(30), { rpe: 5 })).status, 403);
  assert.match((await submitWellness(db, token, { rpe: 7 })).error, /minutes/);
  assert.equal((await submitWellness(db, token, { date: today, session: 'training', minutes: 90, rpe: 7, sleep: 2, soreness: 2, fatigue: 2, stress: 3, mood: 2 })).ok, true);
  assert.equal((await submitWellness(db, token, { date: today, session: 'training', minutes: 90, rpe: 8 })).ok, true, 'sending again updates');
  const w = (await wellnessOverview(db)).find(p => p.slug === 'demo-player-5');
  assert.equal(w.acute, 720);
  const { token: t2 } = await makeWellnessLink(db, STATS, 'demo-player-5');
  assert.equal((await submitWellness(db, token, { rpe: 5, minutes: 10 })).status, 403, 'old link off');
  assert.ok(t2);
  const L = loadSummary([{ entry_date: '2026-11-26', load: 1000 }, { entry_date: '2026-11-10', load: 200 }, { entry_date: '2026-11-03', load: 200, sleep: 1, soreness: 1, fatigue: 1, stress: 1, mood: 1 }], '2026-11-27');
  assert.ok(L.ratio > 1.5); assert.ok(L.flags.some(f => /jumped/.test(f)));
});

test('development: targets with progress; a radar against same-position squad players', async () => {
  assert.match((await saveTarget(db, STATS, { slug: 'demo-player-9', metric: 'goals', target: 0, season: '2026/27' })).error, /target/);
  await saveTarget(db, STATS, { slug: 'demo-player-9', metric: 'goals', target: 10, season: '2026/27' });
  const d = await development(db, 'demo-player-9', '2026/27', DEMO_ROSTER);
  assert.equal(d.group, 'FW');
  const t = d.targets.find(x => x.metric === 'goals');
  assert.ok(t.current >= 2); assert.equal(t.progress, Math.min(100, Math.round((t.current / 10) * 100)));
  assert.ok(d.radar.length >= 4);
});

test('milestones: first appearance, goals and records found once; youth players left off public lists', async () => {
  await updateMilestones(db);
  const ms = await milestones(db);
  assert.ok(ms.some(m => m.key === 'apps:demo-player-9:1'));
  assert.ok(ms.some(m => m.key.startsWith('record:wins:') || m.key.startsWith('record:unbeaten:') || m.key === 'goals:demo-player-9:1'));
  assert.equal((await updateMilestones(db)).length, 0, 'nothing new the second time');
  await setPrivacy(db, ADMIN, 'demo-player-9', { youth: true, youthPublic: false, leftAt: '' });
  assert.ok(!(await milestones(db, { publicOnly: true })).some(m => m.slug === 'demo-player-9'));
  const hub = await publicHub(db, '2026/27');
  assert.ok(!JSON.stringify(hub).includes('demo-player-9'));
  assert.ok(hub.leaders.goals.length >= 1); assert.ok(hub.headToHead.length >= 1); assert.ok(hub.records.longestWinRun >= 1);
  await setPrivacy(db, ADMIN, 'demo-player-9', { youth: false, youthPublic: false, leftAt: '' });
});

test('reports: a branded match report and an opposition pack (HTML for printing to PDF)', async () => {
  const id = await published();
  const h = await matchReportHtml(db, id);
  assert.match(h, /Match report/); assert.match(h, /Save as PDF/); assert.match(h, /Shot map/); assert.match(h, /definitions version 1/);
  const o = await oppositionPackHtml(db, 'Demo United FC', { results: [], periods: [], formations: [], routinesFaced: [], keyPlayers: [], ourFormations: [], bestXi: null, notes: [{ note: '<b>press high</b>', created_by: 'A', created_at: '2026-11-01' }] });
  assert.match(o, /Opposition pack/); assert.ok(o.includes('&lt;b&gt;press high'), 'notes escaped');
});

test('practice matches: never published, not in seasons or totals, deleted for good', async () => {
  const { id } = await createMatch(db, STATS, { practice: true }, {});
  const m = (await getMatch(db, id)).match;
  assert.equal(m.practice, true); assert.equal(m.season, 'Practice');
  assert.match((await publish(db, SENIOR, id, {})).error, /practice/i);
  assert.ok(!(await seasons(db, '2026/27')).includes('Practice'));
  assert.ok(!(await publishedMatches(db, '')).some(s => s.id === id));
  assert.equal((await removeMatch(db, STATS, id, {})).ok, true);
  assert.equal(await db.prepare(`SELECT 1 FROM sx_matches WHERE id = ?`).bind(id).first(), null);
});

test('definitions: version 1 seeded; a new version needs a note and a senior; matches keep their version', async () => {
  const d = await definitions(db);
  assert.equal(d.current, 1); assert.ok(d.items.some(i => i.key === 'pass'));
  assert.match((await newDefinitionsVersion(db, STATS, { changes: { goal: 'x'.repeat(20) }, note: 'test' })).error, /senior/);
  assert.match((await newDefinitionsVersion(db, SENIOR, { changes: { goal: 'New wording for a goal.' }, note: '' })).error, /changed/);
  const r = await newDefinitionsVersion(db, SENIOR, { changes: { goal: 'New wording for a goal.' }, note: 'Clearer wording' });
  assert.equal(r.version, 2);
  const id = await published({ passes: false });
  assert.equal((await getMatch(db, id)).match.definitionsVersion, 2);
});

test('coach accounts: created read-only, cannot publish, and the routes refuse their changes', async () => {
  const src = readFileSync(new URL('../functions/api/stats-centre/[[route]].js', import.meta.url), 'utf8');
  assert.match(src, /s\.user\.readOnly && method === 'POST' && !COACH_POSTS\.has\(key\)/);
  const core = readFileSync(new URL('../functions/api/_lib/statsCentre.js', import.meta.url), 'utf8');
  assert.match(core, /readOnly: s\.role === 'coach'/);
  assert.match(core, /canPublish: !!s\.can_publish && s\.role !== 'coach'/);
});
