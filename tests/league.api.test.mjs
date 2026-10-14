// League APIs end to end: public endpoints and their checks, admin sign-in
// and roles, results (batch and live, with double-tap protection),
// postpone/reschedule/swap, adjustments, tie decisions, rules preview, data
// checks, CSV import/export, history and undo, the link with Matches &
// Fixtures for Lobi Stars matches, and the server-rendered pages.
// Needs the local Pages dev server (ADMIN_CODE=test-code-123). Most tests use
// a test competition of their own; the Lobi Stars test restores what it changes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 7).toUpperCase();
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const call = (method, p, body, headers = ADMIN) => fetch(BASE + p, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), redirect: 'manual' })
  .then(async r => ({ status: r.status, headers: r.headers, text: await r.clone().text(), data: await r.json().catch(() => ({})) }));
const get = (p, h) => call('GET', p, undefined, h);
const sql = command => {
  const file = path.join(tmpdir(), `league-test-${uid()}.sql`);
  writeFileSync(file, command);
  try { execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--file', `"${file}"`], { stdio: 'pipe', shell: true }); }
  finally { rmSync(file, { force: true }); }
};

// A test league of its own: clubs X, Y, Z (codes unique per run).
const T = { codes: [uid(), uid(), uid()].map(c => `T${c.slice(0, 3)}`), comp: null, teams: [], fx: {} };
async function setup() {
  if (T.comp) return T;
  const c = await call('POST', '/api/admin/league/competitions', { name: `Test League ${uid()}`, shortName: `TL ${uid()}`, season: '2026/2027', type: 'league' });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  T.comp = c.data;
  for (const [i, code] of T.codes.entries()) {
    const r = await call('POST', '/api/admin/league/teams', { code, name: `Test ${['Xray', 'Yankee', 'Zulu'][i]} ${code}`, shortName: ['Xray', 'Yankee', 'Zulu'][i], colour: '#336699', competitionId: T.comp.id, aliases: [`${['Xray', 'Yankee', 'Zulu'][i]} Alias ${code}`] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    T.teams.push(r.data.id);
  }
  const [x, y, z] = T.teams;
  for (const [key, h, a, md, date] of [['xy', x, y, 1, '2026-11-07'], ['yz', y, z, 2, '2026-11-14'], ['zx', z, x, 3, '2026-11-21'], ['yx', y, x, 4, '2026-11-28']]) {
    const r = await call('POST', '/api/admin/league/fixtures', { competitionId: T.comp.id, homeTeamId: h, awayTeamId: a, date, time: '16:00', matchday: md });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    T.fx[key] = r.data.id;
  }
  return T;
}
const tq = () => `competition=${T.comp.slug}`;
const fixtureList = async () => (await get(`/api/admin/league/fixtures?${tq()}`)).data.fixtures;

test('public API: overview, table, fixtures, calendar, crest; every parameter checked', async () => {
  const o = await get('/api/league/overview', {});
  assert.equal(o.status, 200);
  assert.equal(o.data.competition.slug, 'nnl-conference-d-2026-27');
  assert.equal(o.data.teams.length, 8);
  assert.equal(o.data.matchday.total, 56);
  assert.match(o.headers.get('cache-control'), /max-age=30, stale-while-revalidate=120/);
  const lobi = await get('/api/league/fixtures?team=lobi', {});
  assert.equal(lobi.data.fixtures.length, 14);
  assert.ok(lobi.data.fixtures.every(f => f.home.isLobi || f.away.isLobi));
  assert.equal((await get('/api/league/fixtures?team=lobi&ha=home', {})).data.fixtures.length, 7);
  assert.equal((await get('/api/league/fixtures?matchday=1', {})).data.fixtures.length, 4);
  const t = await get('/api/league/table', {});
  assert.equal(t.data.rows.length, 8);
  assert.ok(t.data.footnotes.some(n => /separated by goal difference/.test(n)));
  for (const q of ['/api/league/table?scope=sideways', '/api/league/table?upto=x', '/api/league/fixtures?team=nobody', '/api/league/fixtures?status=bogus', '/api/league/fixtures?from=2026/11/01', '/api/league/fixtures?ha=home', '/api/league/fixtures?evil=1', '/api/league/overview?competition=../x', '/api/league/results?scope=home']) {
    assert.equal((await get(q, {})).status, 400, q);
  }
  const ics = await fetch(`${BASE}/api/league/calendar.ics?team=lobi`);
  assert.match(ics.headers.get('content-type'), /text\/calendar/);
  assert.equal((await ics.text()).match(/BEGIN:VEVENT/g).length, 14);
  const one = await (await fetch(`${BASE}/api/league/calendar.ics?fixture=${lobi.data.fixtures[0].id}`)).text();
  assert.equal(one.match(/BEGIN:VEVENT/g).length, 1);
  assert.equal((await fetch(`${BASE}/api/league/crest/LOB`, { redirect: 'manual' })).status, 302);
});

test('admin: sign-in required; Matchday and Media roles allowed, Fan Relations not', async () => {
  assert.equal((await get('/api/admin/league/fixtures', { 'Content-Type': 'application/json' })).status, 401);
  assert.equal((await call('PATCH', '/api/admin/league/fixtures/1', { note: 'x' }, { 'Content-Type': 'application/json' })).status, 401);
  const login = async role => {
    const email = `lg-${role}-${uid()}@example.com`.toLowerCase();
    await call('POST', '/api/admin/staff', { name: `LG ${role}`, email, password: 'Role-Test-2026!', role });
    const l = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
    return { 'Content-Type': 'application/json', Cookie: l.headers.get('set-cookie').split(';')[0], email };
  };
  assert.equal((await get('/api/admin/league/fixtures', await login('matchday'))).status, 200);
  assert.equal((await get('/api/admin/league/table', await login('media'))).status, 200);
  assert.equal((await get('/api/admin/league/fixtures', await login('fan_relations'))).status, 403);
  // league_admin_emails limits the sensitive actions (adjustments, rules, ...) but never results.
  await setup();
  const staff = await login('matchday');
  sql(`INSERT OR REPLACE INTO settings (key, value) VALUES ('league_admin_emails', '["someone-else@example.com"]')`);
  try {
    assert.equal((await call('POST', '/api/admin/league/adjustments', { competition: T.comp.slug, teamId: T.teams[0], points: -1, reason: 'Should be refused' }, staff)).status, 403);
    assert.equal((await call('PATCH', `/api/admin/league/fixtures/${T.fx.yx}`, { note: 'Staff may still edit fixtures' }, staff)).status, 200);
  } finally { sql(`DELETE FROM settings WHERE key = 'league_admin_emails'`); }
});

test('results: batch save with checks and the table before/after; live mode with double-tap protection', async () => {
  await setup();
  const [x, y] = T.teams;
  assert.equal((await call('PUT', '/api/admin/league/results/matchday/1', { competition: T.comp.slug, rows: [{ id: T.fx.xy, status: 'full_time', homeGoals: 2 }] })).status, 400, 'full time needs both scores');
  assert.equal((await call('PUT', '/api/admin/league/results/matchday/1', { competition: T.comp.slug, rows: [{ id: T.fx.xy, status: 'scheduled', homeGoals: 1, awayGoals: 0 }] })).status, 400);
  assert.equal((await call('PUT', '/api/admin/league/results/matchday/2', { competition: T.comp.slug, rows: [{ id: T.fx.xy, status: 'full_time', homeGoals: 1, awayGoals: 0 }] })).status, 400, 'wrong matchday');
  const r = await call('PUT', '/api/admin/league/results/matchday/1', { competition: T.comp.slug, rows: [{ id: T.fx.xy, status: 'full_time', homeGoals: '2', awayGoals: '0', attendance: '1500', referee: 'A. Referee' }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.saved, 1);
  const top = r.data.changes.find(c => c.teamId === x);
  assert.equal(top.pos, 1); assert.equal(top.points, 3);
  // Live: kick-off, goal, a second tap within 3 s is ignored, undo, half time, full time.
  const live = a => call('POST', `/api/admin/league/fixtures/${T.fx.yz}/live`, { action: a });
  assert.equal((await live('goal_home')).status, 409, 'not started');
  assert.equal((await live('kickoff')).status, 200);
  assert.equal((await live('goal_home')).data.fixture.home_goals, 1);
  const twice = await live('goal_home');
  assert.equal(twice.data.ignored, true);
  assert.equal((await live('goal_away')).data.fixture.away_goals, 1);
  assert.equal((await live('undo_goal_away')).data.fixture.away_goals, 0);
  assert.equal((await live('half_time')).data.fixture.status, 'half_time');
  assert.equal((await live('second_half')).data.fixture.status, 'live');
  const ft = await live('full_time');
  assert.equal(ft.data.fixture.status, 'full_time');
  const table = (await get(`/api/league/table?${tq()}`, {})).data;
  assert.equal(table.rows.find(rw => rw.team.id === y).played, 2);
  assert.equal(table.matchday, 2);
});

test('postpone, reschedule, swap; postponed matches on the fixtures list and left out of the calendar', async () => {
  await setup();
  const id = T.fx.zx;
  assert.equal((await call('POST', `/api/admin/league/fixtures/${id}/postpone`, { reason: '' })).status, 400);
  const p = await call('POST', `/api/admin/league/fixtures/${id}/postpone`, { reason: 'Waterlogged pitch' });
  assert.equal(p.status, 200);
  assert.equal(p.data.fixture.status, 'postponed'); assert.equal(p.data.fixture.kickoff_at, null);
  const pub = (await get(`/api/league/fixtures?${tq()}`, {})).data.fixtures.find(f => f.id === id);
  assert.equal(pub.status, 'postponed'); assert.equal(pub.postponedReason, 'Waterlogged pitch'); assert.ok(pub.originalKickoff);
  const ics = await (await fetch(`${BASE}/api/league/calendar.ics?${tq()}`)).text();
  assert.ok(!ics.includes(`fixture-${id}@`), 'postponed match left out of the calendar');
  assert.equal((await call('POST', `/api/admin/league/fixtures/${id}/reschedule`, { date: '31/02/2027', time: '16:00' })).status, 400);
  const rs = await call('POST', `/api/admin/league/fixtures/${id}/reschedule`, { date: '2026-12-02', time: '15:30' });
  assert.equal(rs.status, 200);
  assert.equal(rs.data.fixture.kickoff_at, '2026-12-02T14:30:00Z', 'Nigerian 15:30 stored as 14:30 UTC');
  assert.match(rs.data.fixture.note, /^Rescheduled from Sat 21 Nov/);
  assert.ok((await (await fetch(`${BASE}/api/league/calendar.ics?${tq()}`)).text()).includes(`fixture-${id}@`));
  const sw = await call('POST', `/api/admin/league/fixtures/${id}/swap`, {});
  assert.equal(sw.status, 200);
  assert.equal(sw.data.fixture.home_team_id, T.teams[0]);
  assert.equal((await call('POST', `/api/admin/league/fixtures/${T.fx.xy}/swap`, {})).status, 409, 'a played match cannot be swapped');
  assert.equal((await call('DELETE', `/api/admin/league/fixtures/${T.fx.xy}`)).status, 409, 'a played match cannot be deleted');
  // Bulk: preview first, then apply.
  const prev = await call('POST', '/api/admin/league/matchdays/4/bulk', { competition: T.comp.slug, shiftDays: 1 });
  assert.equal(prev.status, 200); assert.ok(prev.data.preview.length >= 1);
  assert.equal((await fixtureList()).find(f => f.id === T.fx.yx).kickoff, '2026-11-28T15:00:00Z', 'preview changes nothing');
  const app = await call('POST', '/api/admin/league/matchdays/4/bulk', { competition: T.comp.slug, shiftDays: 1, setTime: '17:00', apply: true });
  assert.equal(app.data.changed, 1);
  assert.equal((await fixtureList()).find(f => f.id === T.fx.yx).kickoff, '2026-11-29T16:00:00Z');
});

test('adjustments, tie decisions and rules (preview never saves)', async () => {
  await setup();
  const [x] = T.teams;
  assert.equal((await call('POST', '/api/admin/league/adjustments', { competition: T.comp.slug, teamId: x, points: -3, reason: 'bad' })).status, 400, 'reason 5+ characters');
  const a = await call('POST', '/api/admin/league/adjustments', { competition: T.comp.slug, teamId: x, points: -3, reason: 'Ineligible player (test)' });
  assert.equal(a.status, 200);
  let t = (await get(`/api/league/table?${tq()}`, {})).data;
  const xr = t.rows.find(r => r.team.id === x);
  assert.equal(xr.adjustment, -3);
  assert.ok(t.footnotes.some(n => /-3 points \(Ineligible player \(test\)\)/.test(n)));
  assert.equal((await call('POST', `/api/admin/league/adjustments/${a.data.id}/void`, { reason: 'Overturned on appeal' })).status, 200);
  assert.equal((await call('POST', `/api/admin/league/adjustments/${a.data.id}/void`, { reason: 'Again please' })).status, 409);
  t = (await get(`/api/league/table?${tq()}`, {})).data;
  assert.equal(t.rows.find(r => r.team.id === x).adjustment, 0);
  const adjs = (await get(`/api/admin/league/adjustments?${tq()}`)).data.adjustments;
  assert.ok(adjs.some(j => j.id === a.data.id && j.is_active === 0 && j.void_reason === 'Overturned on appeal'), 'voided, never deleted');
  // Tie decisions need a reason and valid clubs.
  assert.equal((await call('PUT', '/api/admin/league/tie-overrides', { competition: T.comp.slug, decisions: [{ teamId: x, rankHint: 1 }], reason: '' })).status, 400);
  assert.equal((await call('PUT', '/api/admin/league/tie-overrides', { competition: T.comp.slug, decisions: [{ teamId: x, rankHint: 1 }], reason: 'League ruling (test)' })).status, 200);
  assert.ok((await get(`/api/admin/league/tie-overrides?competition=${T.comp.slug}`)).data.overrides.some(o => o.team_id === x));
  // Rules: checks, preview without saving, then save.
  assert.equal((await call('PATCH', '/api/admin/league/rules', { competition: T.comp.slug, tiebreakOrder: ['wins', 'points'] })).status, 400);
  assert.equal((await call('PATCH', '/api/admin/league/rules', { competition: T.comp.slug, zones: [{ from: 1, to: 2, label: 'Up', colour: '#00aa00' }, { from: 2, to: 3, label: 'Down', colour: '#aa0000' }] })).status, 400);
  const pv = await call('PATCH', '/api/admin/league/rules?preview=1', { competition: T.comp.slug, pointsWin: 2 });
  assert.equal(pv.data.preview, true);
  assert.equal(pv.data.after.find(r => r.points === 2 || r.points === 4) !== undefined, true);
  assert.equal((await get(`/api/admin/league/rules?competition=${T.comp.slug}`)).data.rules.points_win, 3, 'preview did not save');
  assert.equal((await call('PATCH', '/api/admin/league/rules', { competition: T.comp.slug, pointsWin: 2, zones: [{ from: 1, to: 1, label: 'Champions', colour: '#1a7f37' }] })).status, 200);
  t = (await get(`/api/league/table?${tq()}`, {})).data;
  assert.deepEqual(t.zones, [{ from: 1, to: 1, label: 'Champions', colour: '#1a7f37' }]);
  assert.equal(t.rows.find(r => r.team.id === x).points, 2, 'a win is now worth 2');
  await call('PATCH', '/api/admin/league/rules', { competition: T.comp.slug, pointsWin: 3 });
  const chk = await get(`/api/admin/league/check?${tq()}`);
  assert.equal(chk.status, 200); assert.ok(Array.isArray(chk.data.warnings));
});

test('CSV import: dry run first, finished matches protected, apply needs confirm; export', async () => {
  await setup();
  // Match 1 has a result (also when this test runs on its own).
  await call('PUT', '/api/admin/league/results/matchday/1', { competition: T.comp.slug, rows: [{ id: T.fx.xy, status: 'full_time', homeGoals: 2, awayGoals: 0 }] });
  const [x, y, z] = T.codes;
  const csv = `match_no,matchday,date,time,home,away,venue\r\n${'1'},1,2026-11-07,18:00,${x},${y},\r\n4,4,29/11/2026,18:00,Yankee Alias ${y},Xray,\r\n9,5,2026-12-05,16:00,${z},${x},\r\n10,5,2026-12-05,16:00,Nobody FC,${x},\r\n11,5,2026-13-05,16:00,${x},${z},`;
  const dry = await call('POST', '/api/admin/league/import?dryRun=1', { csv, competition: T.comp.slug });
  assert.equal(dry.status, 200, JSON.stringify(dry.data));
  const by = Object.fromEntries(dry.data.rows.map(r => [r.line, r]));
  assert.equal(by[2].status, 'error', 'match 1 has a result: protected');
  assert.equal(by[3].status, 'changed', 'alias and short name matched'); assert.ok(by[3].diff.some(d => d.field === 'Kick-off'));
  assert.equal(by[4].status, 'new');
  assert.match(by[5].error, /Unknown club/);
  assert.equal(by[6].status, 'error');
  assert.equal((await fixtureList()).length, 4, 'a dry run changes nothing');
  const noConfirm = await call('POST', '/api/admin/league/import', { csv, competition: T.comp.slug });
  assert.equal(noConfirm.data.dryRun, true, 'without confirm nothing is applied');
  const applied = await call('POST', '/api/admin/league/import', { csv, competition: T.comp.slug, confirm: true });
  assert.equal(applied.data.applied, 2);
  const list = await fixtureList();
  assert.equal(list.length, 5);
  assert.equal(list.find(f => f.matchNo === 4).kickoff, '2026-11-29T17:00:00Z');
  assert.equal(list.find(f => f.matchNo === 1).homeGoals, 2, 'the finished match kept its result');
  const exp = await fetch(`${BASE}/api/admin/league/export/fixtures.csv?${tq()}`, { headers: ADMIN });
  assert.match(exp.headers.get('content-type'), /text\/csv/);
  assert.match(await exp.text(), /^match_no,matchday,date,time,home,away,venue,status/);
  assert.match(await (await fetch(`${BASE}/api/admin/league/export/table.csv?${tq()}`, { headers: ADMIN })).text(), /^pos,club,played/);
});

test('history: every change logged; undo a change, refused once the fixture changed again', async () => {
  await setup();
  const id = T.fx.yx;
  await call('PATCH', `/api/admin/league/fixtures/${id}`, { note: 'First note' });
  await call('PATCH', `/api/admin/league/fixtures/${id}`, { note: 'Second note' });
  const entries = (await get(`/api/admin/league/audit?entity=fixture&q=${id}`)).data.entries.filter(e => e.entity_id === String(id) && e.action === 'fixture.update');
  const [latest, earlier] = entries;
  assert.equal((await call('POST', `/api/admin/league/audit/${earlier.id}/revert`, {})).status, 409, 'changed again since');
  assert.equal((await call('POST', `/api/admin/league/audit/${latest.id}/revert`, {})).status, 200);
  assert.equal((await fixtureList()).find(f => f.id === id).note, 'First note');
});

test('Lobi Stars matches: League drives Matches & Fixtures and Match Centre; the old editor cannot change dates', async () => {
  const lobi = (await get('/api/league/fixtures?team=lobi&matchday=13', {})).data.fixtures[0];
  assert.ok(lobi && lobi.matchUrl, 'linked to a match page');
  const before = (await get('/api/admin/league/fixtures?matchday=13')).data.fixtures.find(f => f.id === lobi.id);
  try {
    const rs = await call('POST', `/api/admin/league/fixtures/${lobi.id}/reschedule`, { date: '2027-03-08', time: '17:00' });
    assert.equal(rs.status, 200);
    const ev = (await get('/api/matches', {})).data.matches.find(m => m.id === before.eventId);
    assert.equal(ev.event_date, '2027-03-08T16:00:00Z', 'the match page follows League');
    // The old editor keeps the League date (prices etc. can still change).
    const evs = (await get('/api/admin/events')).data.events.find(e => e.id === before.eventId);
    const put = await call('PUT', `/api/admin/events/${before.eventId}`, { ...evs, event_date: '2027-05-01T15:00:00Z', vip_price_kobo: evs.vip_price_kobo, active: true });
    assert.equal(put.status, 200); assert.match(put.data.note || '', /League/);
    assert.equal((await get('/api/matches', {})).data.matches.find(m => m.id === before.eventId).event_date, '2027-03-08T16:00:00Z');
    assert.equal((await call('DELETE', `/api/admin/events/${before.eventId}`)).status, 409);
    // A live goal from League shows on the match page.
    await call('POST', `/api/admin/league/fixtures/${lobi.id}/live`, { action: 'kickoff' });
    await call('POST', `/api/admin/league/fixtures/${lobi.id}/live`, { action: 'goal_home' });
    const m = (await get('/api/matches', {})).data.matches.find(x => x.id === before.eventId);
    assert.equal(m.status, 'live'); assert.equal(m.home_score, 1);
  } finally {
    await call('PUT', '/api/admin/league/results/matchday/13', { rows: [{ id: lobi.id, status: 'scheduled', homeGoals: null, awayGoals: null }] });
    await call('POST', `/api/admin/league/fixtures/${lobi.id}/reschedule`, { date: '2027-03-07', time: '16:00' });
    await call('PATCH', `/api/admin/league/fixtures/${lobi.id}`, { note: before.note || '' });
  }
  const restored = (await get('/api/admin/league/fixtures?matchday=13')).data.fixtures.find(f => f.id === lobi.id);
  assert.equal(restored.kickoff, '2027-03-07T15:00:00Z');
  assert.equal(restored.status, 'scheduled');
  assert.equal((await get('/api/matches', {})).data.matches.find(m => m.id === before.eventId).status, 'scheduled');
});

test('public pages are real HTML: fixtures with SportsEvent data, a real table, filtered views not indexed', async () => {
  const fx = await (await fetch(`${BASE}/fixtures/`)).text();
  assert.match(fx, /"@type":"SportsEvent"/);
  assert.match(fx, /"startDate":"2026-12-06T16:00:00\+01:00"/, 'Lobi Stars v Mighty Jets, Sunday 6 Dec, 4 PM Nigerian time');
  assert.match(fx, /Subscribe to Lobi Stars fixtures/);
  assert.match(fx, /href="\/api\/league\/calendar\.ics\?fixture=\d+" download>Add to calendar/);
  const all = await fetch(`${BASE}/fixtures/?view=all`);
  assert.equal(all.headers.get('x-robots-tag'), 'noindex, follow');
  assert.ok(((await all.text()).match(/<article class="fx-card/g) || []).length >= 4);
  const table = await (await fetch(`${BASE}/table/`)).text();
  assert.match(table, /<caption>Nigeria National League, Conference D 2026\/2027<\/caption>/);
  assert.match(table, /<th scope="row" class="club">/);
  assert.equal((table.match(/<tr class="(is-lobi)?"/g) || []).length, 8);
  assert.match(table, /class="is-lobi"/);
  const res = await (await fetch(`${BASE}/results/`)).text();
  assert.match(res, /Lobi Stars form/);
});

after(async () => {
  if (!T.comp) return;
  // The test competition stays only as test data in the local database; mark it not current.
  sql(`UPDATE league_competitions SET is_current = 0 WHERE id = ${Number(T.comp.id)}`);
});
