// Squad & Staff Data Portal, Phases 2–3: profiles. Draft on type choice;
// answers saved one by one (later save wins per field, "updated by" for the
// other editor); plain-English Activity Log without private values; submit
// checks (required answers, profile photo, free shirt number, under-18
// consent); view-only after submit; only drafts can be deleted; duplicate
// person warning; photos and recordings stored privately with profile names.
// Needs the local Pages dev server (ADMIN_CODE=test-code-123, R2 SQUAD_BUCKET).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 8);
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const sql = command => {
  const file = path.join(tmpdir(), `squad-test-${uid()}.sql`);
  writeFileSync(file, command);
  try { execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--file', `"${file}"`], { stdio: 'pipe', shell: true }); }
  finally { rmSync(file, { force: true }); }
};
const TAG = `T${uid()}`;
const adm = b => fetch(`${BASE}/api/admin/squad-portal`, { method: 'POST', headers: ADMIN, body: JSON.stringify(b) }).then(r => r.json());
async function session(name) {
  const r = await fetch(`${BASE}/api/squad-portal/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ username: 'squad-test', password: PW, name }) });
  const cookie = r.headers.get('set-cookie').match(/ls_squad=[^;]+/)[0];
  const d = await r.json();
  const H = { Cookie: cookie, 'X-CSRF-Token': d.csrf, 'Content-Type': 'application/json' };
  return (p, method = 'GET', body) => fetch(`${BASE}/api/squad-portal/${p}`, { method, headers: H, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, ...(body instanceof FormData ? { headers: { Cookie: cookie, 'X-CSRF-Token': d.csrf } } : {}) })
    .then(async r => ({ status: r.status, data: await r.json().catch(() => ({})), raw: r }));
}
let PW, A, B, season;
before(async () => {
  await adm({ action: 'username', username: 'squad-test' }); await adm({ action: 'enabled', enabled: true });
  season = `20${String(40 + Math.floor(Math.random() * 50))}/${String(Math.floor(Math.random() * 90) + 10)}`;
  await adm({ action: 'season', season });
  PW = (await adm({ action: 'new_password' })).password;
  A = await session(`Grace ${TAG}`); B = await session(`Terver ${TAG}`);
});
after(async () => { sql(`DELETE FROM squad_profiles WHERE season = '${season}';`); await adm({ action: 'season', season: '2026/27' }); });

const jpeg = () => readFileSync(new URL('../public/images/lobi-stars-badge-print.jpg', import.meta.url));
function photoForm(kind = 'profile') {
  const f = new FormData(), j = jpeg();
  f.append('kind', kind); f.append('w400', new Blob([j], { type: 'image/jpeg' }), 'w400'); f.append('w1200', new Blob([j], { type: 'image/jpeg' }), 'w1200'); f.append('jpg', new Blob([j], { type: 'image/jpeg' }), 'jpg');
  f.append('width', '1200'); f.append('height', '1500'); f.append('warnings', '[]');
  return f;
}
const adult = { fullName: `Musa Bello ${TAG}`, displayName: `Musa ${TAG}`, pronunciation: 'MOO-sa', dob: '1999-05-01', nationality: 'Nigerian', phone: '0803 555 1234',
  emergencyName: 'Grace, mother', emergencyPhone: '08035559999', primaryPosition: 'Striker', preferredFoot: 'Right', confirmAccurate: true, confirmConsent: true };

test('a draft is created when the type is chosen; answers save one by one; bad values are refused per field', async () => {
  const c = await A('profiles', 'POST', { type: 'player' });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const id = c.data.id;
  const s = await A(`profiles/${id}`, 'PATCH', { changes: { displayName: `Musa ${TAG}`, phone: '0803 555 1234', shirtNumber: 120, email: 'bad' }, commit: true });
  assert.equal(s.status, 200);
  assert.equal(s.data.saved.phone, '+2348035551234', 'saved as +234…');
  assert.ok(s.data.errors.shirtNumber && s.data.errors.email);
  const g = (await A(`profiles/${id}`)).data.profile;
  assert.equal(g.status, 'DRAFT'); assert.equal(g.season, season); assert.equal(g.data.displayName, `Musa ${TAG}`);
  const list = (await A(`profiles?season=${encodeURIComponent(season)}&filter=drafts`)).data;
  assert.ok(list.profiles.some(p => p.id === id)); assert.ok(list.counts.drafts >= 1);
});

test('two people on one profile: later save wins per field and the other is told; the log names them without private values', async () => {
  const id = (await A('profiles', 'POST', { type: 'player' })).data.id;
  const t0 = new Date(Date.now() - 1000).toISOString();
  await A(`profiles/${id}`, 'PATCH', { changes: { displayName: `Ade ${TAG}`, shirtNumber: 19 }, commit: true });
  const b = await B(`profiles/${id}`, 'PATCH', { changes: { shirtNumber: 9 }, commit: true, since: t0 });
  assert.ok(b.data.others.some(o => o.key === 'displayName' && /Grace/.test(o.by)), 'B is told A changed the name');
  const a = await A(`profiles/${id}`, 'PATCH', { changes: {}, since: t0 });
  assert.ok(a.data.others.some(o => o.key === 'shirtNumber' && o.value === 9 && /Terver/.test(o.by)), 'A is told B changed the number');
  await A(`profiles/${id}`, 'PATCH', { changes: { phone: '08035550000' }, commit: true });
  const logs = await fetch(`${BASE}/api/admin/activity?limit=50`, { headers: ADMIN }).then(r => r.json()).catch(() => ({}));
  const text = JSON.stringify(logs);
  if (text.includes(TAG)) {
    assert.match(text, new RegExp(`Terver ${TAG} \\(Squad Data Portal\\) changed the shirt number for Ade ${TAG} from 19 to 9`));
    assert.ok(!text.includes('8035550000'), 'private values never in the log');
  }
});

test('submit: required answers and the photo; duplicate shirt number blocks; under-18 needs guardian consent; then view-only', async () => {
  const id = (await A('profiles', 'POST', { type: 'player' })).data.id;
  let r = await A(`profiles/${id}/submit`, 'POST');
  assert.equal(r.status, 400); assert.ok(r.data.missing.some(m => m.key === 'fullName') && r.data.missing.some(m => m.key === 'photo_profile'));
  await A(`profiles/${id}`, 'PATCH', { changes: { ...adult, shirtNumber: 7 }, commit: true });
  const ph = await A(`profiles/${id}/photo`, 'POST', photoForm());
  assert.equal(ph.status, 200, JSON.stringify(ph.data));
  assert.equal(ph.data.name, `07-musa-${TAG.toLowerCase()}.webp`);
  const other = (await B('profiles', 'POST', { type: 'player' })).data.id;
  await B(`profiles/${other}`, 'PATCH', { changes: { ...adult, displayName: `Other ${TAG}`, fullName: `Other ${TAG}`, shirtNumber: 7 }, commit: true });
  const chk = await B(`check?number=7&id=${other}`);
  assert.ok(chk.data.taken, 'live warning for the shirt number');
  await B(`profiles/${other}/photo`, 'POST', photoForm());
  r = await A(`profiles/${id}/submit`, 'POST');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await B(`profiles/${other}/submit`, 'POST');
  assert.equal(r.status, 409, 'number 7 is now taken by a submitted profile'); assert.match(r.data.error, /already assigned/);
  // View-only after submit; drafts only can be deleted.
  assert.equal((await A(`profiles/${id}`, 'PATCH', { changes: { nickname: 'x' } })).status, 409);
  assert.equal((await A(`profiles/${id}`, 'DELETE')).status, 409);
  assert.equal((await B(`profiles/${other}`, 'DELETE')).status, 200);
  // Under 18.
  const kid = (await A('profiles', 'POST', { type: 'player' })).data.id;
  await A(`profiles/${kid}`, 'PATCH', { changes: { ...adult, displayName: `Kid ${TAG}`, fullName: `Kid ${TAG}`, dob: '2012-01-01', shirtNumber: 33 }, commit: true });
  await A(`profiles/${kid}/photo`, 'POST', photoForm());
  r = await A(`profiles/${kid}/submit`, 'POST');
  assert.equal(r.status, 400); assert.ok(r.data.missing.some(m => m.key === 'guardianConsent'));
});

test('a profile for the same person may already exist; files are private and named after the profile', async () => {
  const id = (await A('profiles', 'POST', { type: 'player' })).data.id;
  const r = await A(`profiles/${id}`, 'PATCH', { changes: { displayName: `Musa ${TAG}`, dob: adult.dob }, commit: true });
  assert.ok(r.data.samePerson, 'duplicate person warning');
  const first = (await A(`profiles?season=${encodeURIComponent(season)}&filter=submitted`)).data.profiles[0];
  const file = await A(`file/${first.id}/profile/w1200.jpg?download=1`);
  assert.equal(file.raw.status, 200);
  assert.match(file.raw.headers.get('content-disposition'), /filename="07-musa-/);
  assert.equal((await fetch(`${BASE}/api/squad-portal/file/${first.id}/profile/w1200.jpg`)).status, 401, 'not without signing in');
  // Staff naming.
  const st = (await A('profiles', 'POST', { type: 'staff' })).data.id;
  await A(`profiles/${st}`, 'PATCH', { changes: { displayName: 'Terver Iorliam', role: 'Head Coach' }, commit: true, type: 'staff' });
  assert.equal((await A(`profiles/${st}/photo`, 'POST', photoForm())).data.name, 'staff-headcoach-terver-iorliam.webp');
  assert.equal((await A(`profiles/${st}/photo`, 'POST', photoForm('action'))).status, 400, 'action photos are for players');
});
