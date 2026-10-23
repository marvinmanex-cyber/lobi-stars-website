// One source of truth (23 Oct 2026, Phase 1): statuses DRAFT → PENDING_APPROVAL →
// LIVE; a live profile keeps its live version (answers AND photo) on the website
// while an edit waits for approval; the web address is fixed at approval and never
// reuses another person's; the old hand-made squad files are listed for a Super
// Admin before being moved or switched off.
// Needs the local Pages dev server (ADMIN_CODE=test-code-123, --r2=SQUAD_BUCKET).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { answersFor } from '../functions/api/_lib/squadMigrate.js';
import { statusOf, isEditable } from '../src/lib/squadFields.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 8);
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const sql = command => {
  const file = path.join(tmpdir(), `squad-live-${uid()}.sql`);
  writeFileSync(file, command);
  try { return execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--json', '--file', `"${file}"`], { stdio: 'pipe', shell: true }).toString(); }
  finally { rmSync(file, { force: true }); }
};
const T = uid().replace(/\d/g, 'x');
const adm = b => fetch(`${BASE}/api/admin/squad-portal`, { method: b ? 'POST' : 'GET', headers: ADMIN, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const rev = (b, qs = '') => fetch(`${BASE}/api/admin/squad-profiles${qs}`, b ? { method: 'POST', headers: ADMIN, body: JSON.stringify(b) } : { headers: ADMIN }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const photo = file => { const f = new FormData(), j = readFileSync(new URL(`../public/images/${file}`, import.meta.url)); f.append('kind', 'profile'); for (const k of ['w400', 'w1200', 'jpg']) f.append(k, new Blob([j], { type: 'image/jpeg' }), k); f.append('width', '1200'); f.append('height', '1500'); f.append('warnings', '[]'); return f; };
let P, season, prevSeason, id;

before(async () => {
  prevSeason = (await adm()).season;
  season = `20${String(40 + Math.floor(Math.random() * 50))}/${String(Math.floor(Math.random() * 90) + 10)}`;
  await adm({ action: 'username', username: 'squad-live' }); await adm({ action: 'enabled', enabled: true }); await adm({ action: 'season', season });
  const pw = (await adm({ action: 'new_password' })).password;
  const r = await fetch(`${BASE}/api/squad-portal/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ username: 'squad-live', password: pw, name: `Live ${T}` }) });
  const cookie = r.headers.get('set-cookie').match(/ls_squad=[^;]+/)[0], d = await r.json();
  P = (p, method = 'GET', body) => fetch(`${BASE}/api/squad-portal/${p}`, { method, headers: body instanceof FormData ? { Cookie: cookie, 'X-CSRF-Token': d.csrf } : { Cookie: cookie, 'X-CSRF-Token': d.csrf, 'Content-Type': 'application/json' }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined })
    .then(async x => ({ status: x.status, data: await x.json().catch(() => ({})) }));
});
after(async () => {
  sql(`DELETE FROM squad_profiles WHERE season = '${season}';`);
  await adm({ action: 'season', season: prevSeason || '2026/27' });
});

test('statuses: draft → awaiting approval → live; live photo and answers stay until a change is approved', async () => {
  id = (await P('profiles', 'POST', { type: 'player' })).data.id;
  await P(`profiles/${id}`, 'PATCH', { commit: true, changes: { surname: `Live${T}`, firstName: 'Sam', dob: '1999-02-02', nationality: 'NG', shirtNumber: 44, positionGroup: 'Forward', preferredFoot: 'Right', phone: '08035551111', emergencyName: 'X', emergencyPhone: '08035552222', confirmAccurate: true, confirmConsent: true } });
  assert.equal((await P(`profiles/${id}/photo`, 'POST', photo('lobi-stars-badge-print.jpg'))).status, 200);
  assert.equal((await P(`profiles/${id}/submit`, 'POST')).status, 200);
  let p = (await P(`profiles/${id}`)).data.profile;
  assert.equal(p.status, 'PENDING_APPROVAL'); assert.equal(p.statusLabel, 'Awaiting approval'); assert.equal(p.editable, false);
  assert.equal((await fetch(`${BASE}/api/squad/photo/${id}/profile/w400.webp`)).status, 404, 'nothing public before approval');
  assert.equal((await rev({ action: 'approve', id })).status, 200);
  const pub = await fetch(`${BASE}/api/squad/public`).then(x => x.json());
  const live = pub.players.find(x => x.id === id);
  assert.equal(live.slug, `sam-live${T.toLowerCase()}`);
  const first = await fetch(`${BASE}/api/squad/photo/${id}/profile/w1200.jpg`).then(r => r.arrayBuffer());
  // The portal changes the photo and an answer: the website keeps the live ones.
  assert.equal((await P(`profiles/${id}/photo`, 'POST', photo('og-default.jpg'))).status, 200);
  await P(`profiles/${id}`, 'PATCH', { commit: true, changes: { heightCm: 181 } });
  p = (await P(`profiles/${id}`)).data.profile;
  assert.equal(p.status, 'LIVE'); assert.equal(p.pending, 'DRAFT'); assert.match(p.statusLabel, /Live · edit not sent yet/); assert.equal(p.editable, true);
  const still = await fetch(`${BASE}/api/squad/photo/${id}/profile/w1200.jpg`).then(r => r.arrayBuffer());
  assert.equal(still.byteLength, first.byteLength, 'the live photo is not replaced before approval');
  assert.equal((await fetch(`${BASE}/api/squad/public`).then(x => x.json())).players.find(x => x.id === id).heightCm ?? null, null, 'the live answers stay');
  const newThumb = p.photos.profile.url;
  assert.match(newThumb, /\?rev=/);
  assert.equal((await fetch(`${BASE}${newThumb}`, { headers: ADMIN })).status, 200, 'the club sees the new photo');
  assert.equal((await P(`profiles/${id}/submit`, 'POST')).status, 200);
  assert.equal((await P(`profiles/${id}`)).data.profile.editable, false, 'locked while waiting for approval');
  assert.equal((await rev({ action: 'approve', id })).status, 200);
  const after = await fetch(`${BASE}/api/squad/photo/${id}/profile/w1200.jpg`).then(r => r.arrayBuffer());
  assert.notEqual(after.byteLength, first.byteLength, 'the new photo is live after approval');
  assert.equal((await fetch(`${BASE}/api/squad/public`).then(x => x.json())).players.find(x => x.id === id).heightCm, 181);
  // Version 1's photo is kept (an earlier version can be restored with its photo).
  const v = (await rev(null, `?versions=${id}`)).data.versions;
  assert.deepEqual(v.map(x => x.n), [2, 1]);
});

test('web address: another person with the same name gets -2; a former person\'s address is never reused', async () => {
  const twin = (await P('profiles', 'POST', { type: 'player' })).data.id;
  await P(`profiles/${twin}`, 'PATCH', { commit: true, changes: { surname: `Live${T}`, firstName: 'Sam', dob: '2001-05-05', nationality: 'NG', shirtNumber: 45, positionGroup: 'Forward', preferredFoot: 'Left', phone: '08035551111', emergencyName: 'X', emergencyPhone: '08035552222', confirmAccurate: true, confirmConsent: true } });
  await P(`profiles/${twin}/photo`, 'POST', photo('lobi-stars-badge-print.jpg'));
  assert.equal((await P(`profiles/${twin}/submit`, 'POST')).status, 200);
  assert.equal((await rev({ action: 'approve', id: twin })).data.slug, `sam-live${T.toLowerCase()}-2`);
  assert.equal((await rev({ action: 'left', id })).status, 200);
  const pub = await fetch(`${BASE}/api/squad/public`).then(x => x.json());
  assert.ok(!pub.players.some(x => x.id === id), 'a former player is off the Squad page');
  assert.equal(pub.players.find(x => x.id === twin).slug, `sam-live${T.toLowerCase()}-2`, 'the twin keeps -2: the former player\'s address stays theirs');
  assert.ok((await rev(null, `?season=${encodeURIComponent(season)}&filter=former`)).data.profiles.some(x => x.id === id));
});

test('old squad files: listed first (placeholders marked), then moved and switched off', async () => {
  const L = (await rev(null, '?legacy=1')).data;
  assert.ok(Array.isArray(L.list) && L.list.length >= 1, JSON.stringify(L).slice(0, 200));
  assert.ok(L.list.filter(e => e.name.startsWith('Sample')).every(e => e.isSample), 'samples are marked as placeholders');
  const coachFile = L.list.find(e => e.key === 'staff/head-coach');
  if (coachFile) assert.equal(coachFile.isSample, true, 'a "Head Coach" file without a name is a placeholder');
  const before = sql(`SELECT value FROM squad_portal_settings WHERE key IN ('legacy_off', 'legacy_migrated');`);
  try {
    const pick = L.list.find(e => e.kind === 'player');
    const r = await rev({ action: 'migrate', keys: [pick.key], switchOff: true });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.switchedOff, true);
    const moved = (await rev(null, `?filter=migrated&season=all`)).data.profiles.find(x => x.name === r.data.migrated[0]);
    assert.ok(moved, 'the moved person is live and marked "migrated – please review"');
    assert.equal(moved.status, 'LIVE'); assert.equal(moved.migrated, true);
    assert.equal((await fetch(`${BASE}/api/squad/public`).then(x => x.json())).legacyOff, true, 'the website build is told to use portal profiles only');
    sql(`DELETE FROM squad_profiles WHERE id = '${moved.id}';`);
  } finally {
    void before;
    sql(`DELETE FROM squad_portal_settings WHERE key IN ('legacy_off', 'legacy_off_at', 'legacy_off_by', 'legacy_migrated');`);
  }
  assert.equal((await fetch(`${BASE}/api/admin/squad-profiles?legacy=1`)).status, 401);
});

test('mapping an old file to portal answers; the status helpers', () => {
  const a = answersFor({ kind: 'player', name: 'Terna Akaa', number: 9, position: 'FWD', nationality: 'Nigeria', stateOfOrigin: 'Benue State', dob: '2002-03-20', height: '1.79 m', preferredFoot: 'Right', bio: 'Striker.' });
  assert.deepEqual([a.firstName, a.surname, a.shirtNumber, a.positionGroup, a.nationality, a.stateOfOrigin, a.heightCm, a.preferredFoot], ['Terna', 'Akaa', 9, 'Forward', 'NG', 'Benue', 179, 'Right']);
  assert.equal(statusOf({ status: 'LIVE', pending: 'PENDING_APPROVAL' }).key, 'PENDING_APPROVAL');
  assert.equal(statusOf({ status: 'LIVE' }).label, 'Live');
  assert.equal(isEditable({ status: 'LIVE', pending: 'PENDING_APPROVAL' }), false);
  assert.equal(isEditable({ status: 'LIVE', pending: null }), true);
  assert.equal(isEditable({ status: 'FORMER' }), false);
});
