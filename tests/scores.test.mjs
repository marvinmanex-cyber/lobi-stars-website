// Score verification, Phase 1, on the server: who can use it, the sources and
// their licence rules, reports stored and never overwritten, official results
// need a note, and the "Unmatched names" flow (link once → alias → recognised).
// Needs the local Pages dev server with ADMIN_CODE=test-code-123.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 8);
const sql = command => {
  const file = path.join(tmpdir(), `scores-test-${uid()}.sql`);
  writeFileSync(file, command);
  try { execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--file', `"${file}"`], { stdio: 'pipe', shell: true }); }
  finally { rmSync(file, { force: true }); }
};
const made = [], TAG = `zz${uid()}`;
async function staff(role) {
  const email = `sc-${role}-${uid()}@example.com`;
  const r = await fetch(`${BASE}/api/admin/staff`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ name: `Scores ${role}`, email, password: 'Role-Test-2026!', role }) });
  made.push((await r.json()).id);
  const login = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.8.${(Math.random() * 250) | 0}.3` }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
  return { Cookie: login.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' };
}
const call = (p, method = 'GET', body, h = ADMIN) => fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
let restoreAlias = null;
after(async () => {
  sql(`DELETE FROM score_reports WHERE home_name LIKE '%${TAG}%' OR raw_json LIKE '%${TAG}%'; DELETE FROM score_unmatched_names WHERE name LIKE '%${TAG}%';
       UPDATE score_sources SET enabled = 0, licence_confirmed = 0, licence_note = NULL WHERE type = 'FUTURE_LICENSED';`);
  if (restoreAlias) sql(`UPDATE league_teams SET aliases = '${restoreAlias.aliases.replace(/'/g, "''")}' WHERE id = ${restoreAlias.id};`);
  for (const id of made) await fetch(`${BASE}/api/admin/staff/${id}`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ active: false, reason: 'test finished' }) });
});

test('only the Website & Data Officer (Matchday Admin) and Super Admins', async () => {
  assert.equal((await call('/api/admin/scores/sources', 'GET', null, await staff('matchday_admin'))).status, 200);
  for (const role of ['head_of_media', 'fan_support', 'content_editor']) assert.equal((await call('/api/admin/scores/sources', 'GET', null, await staff(role))).status, 403, role);
  assert.equal((await fetch(`${BASE}/api/admin/scores/sources`)).status, 401);
  const page = await fetch(`${BASE}/admin/scores/sources/`, { headers: { Cookie: (await staff('fan_support')).Cookie }, redirect: 'manual' });
  assert.equal(page.status, 403);
});

test('sources: all seven listed; licensed ones stay off until a Super Admin confirms the licence with a note', async () => {
  const s = (await call('/api/admin/scores/sources')).data;
  assert.deepEqual(s.sources.map(x => x.type).sort(), ['CLUB_NETWORK', 'COMMENTARY_ASSIST', 'FUTURE_LICENSED', 'LICENSED_API', 'LIVE_MATCH_CONTROL', 'OFFICIAL_NNL', 'STAFF_MANUAL']);
  assert.equal(s.sources.find(x => x.type === 'LICENSED_API').enabled, false);
  assert.equal(s.sources.find(x => x.type === 'FUTURE_LICENSED').enabled, false);
  assert.equal((await call('/api/admin/scores/sources', 'PUT', { type: 'FUTURE_LICENSED', enabled: true })).status, 400, 'no licence: can\'t switch on');
  const md = await staff('matchday_admin');
  assert.equal((await call('/api/admin/scores/sources', 'PUT', { type: 'FUTURE_LICENSED', licenceConfirmed: true, licenceNote: 'We have a licence from them, ref 42.' }, md)).status, 403, 'only Super Admins confirm a licence');
  assert.equal((await call('/api/admin/scores/sources', 'PUT', { type: 'FUTURE_LICENSED', licenceConfirmed: true, licenceNote: 'ok' })).status, 400, 'a real note is needed');
  assert.equal((await call('/api/admin/scores/sources', 'PUT', { type: 'FUTURE_LICENSED', enabled: true, licenceConfirmed: true, licenceNote: `Written permission, test ${TAG}, 21 Oct 2026` })).status, 200);
  assert.equal((await call('/api/admin/scores/sources', 'PUT', { type: 'FUTURE_LICENSED', enabled: false, licenceConfirmed: false, licenceNote: '' })).status, 200);
  assert.equal((await call('/api/admin/scores/sources', 'PUT', { type: 'STAFF_MANUAL', priority: 500 })).status, 400);
  const cov = (await call('/api/admin/scores/sources', 'POST', { action: 'coverage_test', type: 'LICENSED_API' })).data;
  assert.equal(cov.ok, false);
  assert.match(cov.result, /switched off/);
  assert.equal((await call('/api/admin/scores/sources', 'POST', { action: 'coverage_test', type: 'LICENSED_API' }, { ...ADMIN, Origin: 'https://evil.example' })).status, 403);
});

test('reports are stored and never overwritten; the same staff member twice counts once; official needs a note', async () => {
  const fx = (await call('/api/admin/league/fixtures')).data;
  const fixture = (fx.fixtures || fx.items || [])[0];
  assert.ok(fixture, 'a fixture to report on');
  const before = (await call(`/api/admin/scores/reports?fixture=${fixture.id}`)).data.reports.length;
  const r1 = await call('/api/admin/scores/reports', 'POST', { fixtureId: fixture.id, homeGoals: 1, awayGoals: 0, status: 'LIVE', minute: '30', note: TAG });
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  const r2 = await call('/api/admin/scores/reports', 'POST', { fixtureId: fixture.id, homeGoals: 2, awayGoals: 0, status: 'FULL_TIME' });
  assert.equal(r2.status, 200);
  const d = (await call(`/api/admin/scores/reports?fixture=${fixture.id}`)).data;
  assert.equal(d.reports.length, before + 2, 'both reports kept');
  assert.equal(d.latest.filter(x => x.source_type === 'STAFF_MANUAL').length, 1, 'the same person counts once');
  assert.equal(d.latest.find(x => x.source_type === 'STAFF_MANUAL').home_goals, 2, 'their latest report is used');
  assert.equal((await call('/api/admin/scores/reports', 'POST', { fixtureId: fixture.id, homeGoals: 2, awayGoals: 0, status: 'FULL_TIME', official: true })).status, 400, 'official result needs a note');
  assert.equal((await call('/api/admin/scores/reports', 'POST', { fixtureId: fixture.id, homeGoals: 2, status: 'FULL_TIME' })).status, 400, 'both scores needed');
  assert.equal((await call('/api/admin/scores/reports', 'POST', { fixtureId: fixture.id, homeGoals: 2, awayGoals: 0, status: 'WON' })).status, 400);
  sql(`DELETE FROM score_reports WHERE id IN (${r1.data.id}, ${r2.data.id});`);
});

test('unknown team names go to "Unmatched names"; linking once saves an alias and the name is recognised', async () => {
  const name = `Bida Lions ${TAG}`;
  const teams = (await call('/api/admin/scores/unmatched')).data.teams;
  const target = teams.find(t => /Mighty Jets/i.test(t.name)) || teams[0];
  const other = teams.find(t => t.id !== target.id);
  const r = await call('/api/admin/scores/reports', 'POST', { homeName: name, awayName: other.name, homeGoals: 1, awayGoals: 1, status: 'FULL_TIME' });
  assert.equal(r.status, 200);
  assert.equal(r.data.needsReview, true);
  assert.match(r.data.reason, /not recognised/);
  const u = (await call('/api/admin/scores/unmatched')).data.open.find(x => x.name === name);
  assert.ok(u, 'listed as unmatched');
  restoreAlias = { id: target.id, aliases: JSON.stringify(target.aliases) };
  const link = await call('/api/admin/scores/unmatched', 'POST', { action: 'link', id: u.id, teamId: target.id });
  assert.equal(link.status, 200, JSON.stringify(link.data));
  assert.ok((await call('/api/admin/scores/unmatched')).data.teams.find(t => t.id === target.id).aliases.includes(name), 'saved as an alias');
  const again = await call('/api/admin/scores/reports', 'POST', { homeName: name.toUpperCase() + ' FC', awayName: other.name, homeGoals: 1, awayGoals: 1, status: 'FULL_TIME' });
  assert.doesNotMatch(again.data.reason || '', /not recognised/, 'recognised now (case and "FC" ignored)');
});
