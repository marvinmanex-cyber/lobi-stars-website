// Squad & Staff Data Portal, Phases 5–6: club review and publishing, the
// partner API and export data. Verify → public list (public fields only);
// request changes → the portal shows the note and can edit again; left the club
// → off the website; the partner API (key, Public + Media only, ?since=, signed
// links); portal / admin export data never contain private fields; full club
// records only for Super Admins.
// Needs the local Pages dev server (ADMIN_CODE=test-code-123, LOBI_PARTNER_API_KEY=partner-test-key, R2 SQUAD_BUCKET).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validatePackage } from '../src/lib/squadPackage.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const KEY = process.env.LOBI_PARTNER_API_KEY || 'partner-test-key';
const uid = () => Math.random().toString(36).slice(2, 8);
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const sql = command => {
  const file = path.join(tmpdir(), `squad-rev-${uid()}.sql`);
  writeFileSync(file, command);
  try { execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--file', `"${file}"`], { stdio: 'pipe', shell: true }); }
  finally { rmSync(file, { force: true }); }
};
const TAG = `R${uid()}`;
const L = TAG.toLowerCase().replace(/[0-9]/g, d => 'abcdefghij'[d]); // names are letters only
const adm = b => fetch(`${BASE}/api/admin/squad-portal`, { method: 'POST', headers: ADMIN, body: JSON.stringify(b) }).then(r => r.json());
const rev = (b, qs = '') => fetch(`${BASE}/api/admin/squad-profiles${qs}`, b ? { method: 'POST', headers: ADMIN, body: JSON.stringify(b) } : { headers: ADMIN }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
// Never shared (the full date of birth is public from age 18, so it is not in this list).
const PRIV = ['fullName', 'displayName', 'pronunciation', 'phone', 'email', 'emergencyName', 'emergencyPhone', 'guardianName', 'guardianPhone', 'confirmAccurate', 'confirmConsent', 'guardianConsent'];
let P, season, prevSeason, id, staffId;
async function portal() {
  const pw = (await adm({ action: 'new_password' })).password;
  const r = await fetch(`${BASE}/api/squad-portal/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ username: 'squad-rev', password: pw, name: `Grace ${TAG}` }) });
  const cookie = r.headers.get('set-cookie').match(/ls_squad=[^;]+/)[0], d = await r.json();
  return (p, method = 'GET', body) => fetch(`${BASE}/api/squad-portal/${p}`, { method, headers: body instanceof FormData ? { Cookie: cookie, 'X-CSRF-Token': d.csrf } : { Cookie: cookie, 'X-CSRF-Token': d.csrf, 'Content-Type': 'application/json' }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined })
    .then(async x => ({ status: x.status, data: await x.json().catch(() => ({})), raw: x }));
}
const photo = () => { const f = new FormData(), j = readFileSync(new URL('../public/images/lobi-stars-badge-print.jpg', import.meta.url)); f.append('kind', 'profile'); for (const k of ['w400', 'w1200', 'jpg']) f.append(k, new Blob([j], { type: 'image/jpeg' }), k); f.append('width', '1200'); f.append('height', '1500'); f.append('warnings', '[]'); return f; };
const answers = { surname: `Pub${L}`, firstName: 'Ade', middleName: 'Okoh', dob: '2000-02-02', nationality: 'NG', phone: '08035551111', email: `p.${TAG.toLowerCase()}@example.com`,
  emergencyName: `Mama ${TAG}`, emergencyPhone: '08035552222', positionGroup: 'Defender', primaryPosition: 'Centre back', preferredFoot: 'Left', shirtNumber: 44, confirmAccurate: true, confirmConsent: true, careerHighlight: 'Captain in 2025', hometown: 'Otukpo, Otukpo LGA' };

before(async () => {
  const cur = (await rev(null, '?filter=all')).data;
  prevSeason = cur.current;
  season = `20${String(40 + Math.floor(Math.random() * 50))}/${String(Math.floor(Math.random() * 90) + 10)}`;
  await adm({ action: 'username', username: 'squad-rev' }); await adm({ action: 'enabled', enabled: true }); await adm({ action: 'season', season });
  P = await portal();
  id = (await P('profiles', 'POST', { type: 'player' })).data.id;
  await P(`profiles/${id}`, 'PATCH', { changes: answers, commit: true });
  await P(`profiles/${id}/photo`, 'POST', photo());
  assert.equal((await P(`profiles/${id}/submit`, 'POST')).status, 200);
  staffId = (await P('profiles', 'POST', { type: 'staff' })).data.id;
  await P(`profiles/${staffId}`, 'PATCH', { changes: { ...answers, surname: `Coach${L}`, firstName: 'Tom', role: 'Head Coach', qualifications: 'CAF B Licence', philosophy: 'Press high' }, commit: true, type: 'staff' });
  await P(`profiles/${staffId}/photo`, 'POST', photo());
  assert.equal((await P(`profiles/${staffId}/submit`, 'POST')).status, 200);
});
after(async () => { sql(`DELETE FROM squad_profiles WHERE season = '${season}' OR display_name LIKE '%${TAG}%';`); await adm({ action: 'season', season: prevSeason || '2026/27' }); });

test('waiting for review: on the bell and in the list; the reviewer sees everything, including private details', async () => {
  const bell = (await fetch(`${BASE}/api/admin/notifications`, { headers: ADMIN }).then(r => r.json())).items;
  assert.ok(bell.some(i => /squad profile.*waiting for review/.test(i.title)));
  const l = (await rev(null, `?season=${encodeURIComponent(season)}&filter=submitted`)).data;
  assert.ok(l.profiles.some(p => p.id === id));
  const one = (await rev(null, `?id=${id}`)).data.profile;
  assert.equal(one.data.phone, '+2348035551111', 'private details visible to the club reviewer');
});

test('request changes → the portal sees the note and can edit; verify → public (public fields only)', async () => {
  assert.equal((await rev({ action: 'request_changes', id, note: '' })).status, 400, 'a note is needed');
  assert.equal((await rev({ action: 'request_changes', id, note: `Please add the height ${TAG}` })).status, 200);
  const row = (await P(`profiles?season=${encodeURIComponent(season)}&filter=changes`)).data.profiles.find(p => p.id === id);
  assert.match(row.reviewNote, /add the height/);
  assert.equal((await P(`profiles/${id}`, 'PATCH', { changes: { heightCm: 186 }, commit: true })).status, 200, 'editable again');
  assert.equal((await P(`profiles/${id}/submit`, 'POST')).status, 200);
  assert.equal((await rev({ action: 'verify', id })).status, 200);
  assert.equal((await rev({ action: 'verify', id: staffId })).status, 200);
  const pub = await fetch(`${BASE}/api/squad/public`).then(r => r.json());
  const p = pub.players.find(x => x.id === id), s = pub.staff.find(x => x.id === staffId);
  assert.ok(p && s, 'published');
  assert.equal(p.age, 26); assert.equal(p.heightCm, 186); assert.equal(p.group, 'DEF');
  const text = JSON.stringify(pub);
  assert.equal(p.dob, '2000-02-02', 'full date of birth public from 18'); assert.equal(p.officialName, `PUB${L.toUpperCase()}, Ade`, 'middle name never public'); assert.ok(!JSON.stringify(pub).includes('Okoh'));
  for (const secret of ['+2348035551111', answers.email, `Mama ${TAG}`, 'Captain in 2025', 'Press high']) assert.ok(!text.includes(secret), `not public: ${secret}`);
  assert.equal((await fetch(`${BASE}${p.photo}`)).status, 200, 'public photo of a verified profile');
});

test('partner API: key needed; Public + Media only in the Data Package structure; ?since=; signed 24-hour links', async () => {
  assert.equal((await fetch(`${BASE}/api/partner/squad`)).status, 401);
  assert.equal((await fetch(`${BASE}/api/partner/squad`, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  const doc = await fetch(`${BASE}/api/partner/squad`, { headers: { Authorization: `Bearer ${KEY}` } }).then(r => r.json());
  assert.equal(doc.schemaVersion, '1.2'); assert.deepEqual(validatePackage(doc), []);
  const pl = doc.players.find(x => x.id === id), st = doc.staff.find(x => x.id === staffId);
  assert.equal(pl.notes.careerHighlight, 'Captain in 2025', 'media notes included'); assert.equal(pl.pronunciation, null, 'no pronunciation any more (null in 1.2)');
  assert.equal(st.notes.philosophy, 'Press high'); assert.equal(st.role, 'Head Coach');
  const text = JSON.stringify(doc);
  for (const secret of ['+2348035551111', answers.email, `Mama ${TAG}`]) assert.ok(!text.includes(secret), `never in the partner API: ${secret}`);
  const r = await fetch(pl.photos.profile.replace(/^https?:\/\/[^/]+/, BASE));
  assert.equal(r.status, 200, 'signed photo link works');
  assert.equal((await fetch(pl.photos.profile.replace(/^https?:\/\/[^/]+/, BASE).replace(/sig=\w+/, 'sig=bad'))).status, 403, 'tampered link refused');
  const later = await fetch(`${BASE}/api/partner/squad?since=${encodeURIComponent(new Date(Date.now() + 60000).toISOString())}`, { headers: { 'X-API-Key': KEY } }).then(r => r.json());
  assert.ok(!later.players.some(x => x.id === id), '?since= returns only changes');
});

test('export data: Super Admins only (never the portal or the Website & Data Officer); Public and Media only; emailed to the chosen admins', async () => {
  assert.equal((await P(`export-data?which=verified&season=current`)).status, 403, 'no exports from the portal');
  assert.equal((await P('export-data', 'POST', { format: 'zip' })).status, 403);
  const ae = (await rev(null, '?export=1&which=verified&season=current')).data;
  for (const d of [ae]) {
    const p = d.profiles.find(x => x.id === id);
    assert.ok(p, 'included');
    for (const k of PRIV) assert.ok(!(k in p.data), `no ${k}`);
    assert.equal(p.data.age, 26);
  }
  const full = await rev({ action: 'full_records', which: 'verified', season: 'current' });
  assert.equal(full.status, 200, JSON.stringify(full.data));
  assert.equal(full.data.profiles.find(x => x.id === id).data.phone, '+2348035551111', 'full records include private details');
  const email = `sr-${uid()}@example.com`;
  const made = await fetch(`${BASE}/api/admin/staff`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ name: 'Data Officer', email, password: 'Role-Test-2026!', role: 'matchday_admin' }) }).then(r => r.json());
  const l = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
  const H = { Cookie: l.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' };
  const officer = await fetch(`${BASE}/api/admin/squad-profiles?filter=all`, { headers: H });
  assert.equal(officer.status, 200, 'the Website & Data Officer reviews');
  const od = await officer.json(); assert.equal(od.canExport, false); assert.deepEqual(od.exportLog, [], 'no export log for them');
  assert.equal((await fetch(`${BASE}/api/admin/squad-profiles?export=1&which=verified&season=current`, { headers: H })).status, 403, 'no export data for them');
  assert.equal((await fetch(`${BASE}/api/admin/squad-profiles/export-email`, { method: 'POST', headers: { ...H, 'Content-Type': 'text/plain', 'X-File-Name': 'x.pdf', 'X-Format': 'pdf' }, body: 'JVBERi0=' })).status, 403, 'nor email one');
  assert.equal((await fetch(`${BASE}/api/admin/squad-profiles`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'full_records' }) })).status, 403, 'but not the full records');
  assert.equal((await fetch(`${BASE}/api/admin/squad-profiles`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'remove', id }) })).status, 403, 'nor remove');
  await fetch(`${BASE}/api/admin/staff/${made.id}`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ active: false, reason: 'test finished' }) });
  // A Super Admin's export is emailed (no email service on the test server: a clear message).
  const em = await fetch(`${BASE}/api/admin/squad-profiles/export-email`, { method: 'POST', headers: { 'x-admin-code': ADMIN['x-admin-code'], 'Content-Type': 'text/plain', 'X-File-Name': 'lobi.pdf', 'X-Format': 'pdf', 'X-Profiles': '2' }, body: 'JVBERi0=' });
  assert.equal(em.status, 503); assert.match((await em.json()).error, /Download to this computer/);
  // Recipients: dkakaan@lobistarsfc.com always; others only if they are admin accounts.
  const s0 = await fetch(`${BASE}/api/admin/squad-portal`, { headers: ADMIN }).then(r => r.json());
  assert.ok(s0.exportRecipients.includes('dkakaan@lobistarsfc.com'));
  assert.equal((await adm({ action: 'export_recipients', emails: ['stranger@example.com'] })).error.includes('Only admin accounts'), true);
  const anAdmin = s0.admins.find(a => a.email !== 'dkakaan@lobistarsfc.com')?.email;
  if (anAdmin) { const ok = await adm({ action: 'export_recipients', emails: [anAdmin] }); assert.ok(ok.exportRecipients.includes(anAdmin)); await adm({ action: 'export_recipients', emails: [] }); }
  await rev({ action: 'export_log', format: 'zip', which: 'verified', season: 'current', profiles: 2, ok: true });
  assert.ok((await rev(null, '?filter=all')).data.exportLog.some(x => x.format === 'zip'), 'export logged');
});

test('left the club → off the website and the partner API; restore; new season carries live profiles over (still live, confirmations asked again)', async () => {
  assert.equal((await rev({ action: 'left', id })).status, 200);
  assert.ok(!(await fetch(`${BASE}/api/squad/public`).then(r => r.json())).players.some(x => x.id === id));
  assert.ok(!(await fetch(`${BASE}/api/partner/squad`, { headers: { 'X-API-Key': KEY } }).then(r => r.json())).players.some(x => x.id === id));
  const all = (await rev(null, '?export=1&which=verified&season=all')).data;
  assert.ok(all.profiles.some(x => x.id === id && x.status === 'FORMER'), 'kept in "all seasons" exports');
  assert.equal((await rev({ action: 'restore', id })).status, 200);
  const next = `${season.slice(0, 4)}/99`;
  const c = await rev({ action: 'carry_over', from: season, to: next });
  assert.equal(c.status, 200, JSON.stringify(c.data)); assert.equal(c.data.copied, 2);
  const drafts = (await rev(null, `?season=${encodeURIComponent(next)}&filter=drafts`)).data.profiles;
  assert.equal(drafts.length, 2);
  assert.ok(drafts.every(x => x.status === 'LIVE' && x.pending === 'DRAFT'), 'still live; an edit waits for the season confirmations');
  sql(`DELETE FROM squad_profiles WHERE season = '${next}';`);
});
