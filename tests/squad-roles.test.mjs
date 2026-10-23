// Squad Phase 3 (23 Oct 2026): roles. The starting list (coaching / club staff),
// "Goalkeeper Trainer" → "Goalkeeper Coach", only listed roles (or Other) accepted,
// "Other" tidied and matched to an existing role, a new one waiting for a Super
// Admin (New role request), and Squad › Roles: rename, merge, category (on / off
// the Squad page at once), order, switch off. Club staff have no public page.
// Needs the local Pages dev server (ADMIN_CODE=test-code-123, --r2=SQUAD_BUCKET).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { tidyRole, roleKey } from '../functions/api/_lib/squadRoles.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 8);
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const sql = command => {
  const file = path.join(tmpdir(), `squad-roles-${uid()}.sql`);
  writeFileSync(file, command);
  try { return execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--json', '--file', `"${file}"`], { stdio: 'pipe', shell: true }).toString(); }
  finally { rmSync(file, { force: true }); }
};
const T = uid().replace(/\d/g, 'x');
const NEW_ROLE = tidyRole(`Video Analyst ${T}`); // as the portal tidies it
const adm = b => fetch(`${BASE}/api/admin/squad-portal`, { method: b ? 'POST' : 'GET', headers: ADMIN, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const roles = (b) => fetch(`${BASE}/api/admin/squad-roles`, b ? { method: 'POST', headers: ADMIN, body: JSON.stringify(b) } : { headers: ADMIN }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const ap = (b, qs = '') => fetch(`${BASE}/api/admin/squad-approvals${qs}`, b ? { method: 'POST', headers: ADMIN, body: JSON.stringify(b) } : { headers: ADMIN }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const photo = () => { const f = new FormData(), j = readFileSync(new URL('../public/images/lobi-stars-badge-print.jpg', import.meta.url)); f.append('kind', 'profile'); for (const k of ['w400', 'w1200', 'jpg']) f.append(k, new Blob([j], { type: 'image/jpeg' }), k); f.append('width', '1200'); f.append('height', '1500'); f.append('warnings', '[]'); return f; };
const base = (first) => ({ surname: `Role${T}`, firstName: first, dob: '1980-01-01', nationality: 'NG', phone: '08035551111', emergencyName: 'X', emergencyPhone: '08035552222', confirmAccurate: true, confirmConsent: true });
let P, session, season, prevSeason, kit, other;

async function staff(first, changes) {
  const id = (await P('profiles', 'POST', { type: 'staff' })).data.id;
  const s = await P(`profiles/${id}`, 'PATCH', { commit: true, changes: { ...base(first), ...changes } });
  await P(`profiles/${id}/photo`, 'POST', photo());
  return { id, save: s.data };
}

before(async () => {
  prevSeason = (await adm()).season;
  season = `20${String(40 + Math.floor(Math.random() * 50))}/${String(Math.floor(Math.random() * 90) + 10)}`;
  await adm({ action: 'username', username: 'squad-roles' }); await adm({ action: 'enabled', enabled: true }); await adm({ action: 'season', season });
  const pw = (await adm({ action: 'new_password' })).password;
  const r = await fetch(`${BASE}/api/squad-portal/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ username: 'squad-roles', password: pw, name: `Ada ${T}` }) });
  const cookie = r.headers.get('set-cookie').match(/ls_squad=[^;]+/)[0], d = await r.json();
  P = (p, method = 'GET', body) => fetch(`${BASE}/api/squad-portal/${p}`, { method, headers: body instanceof FormData ? { Cookie: cookie, 'X-CSRF-Token': d.csrf } : { Cookie: cookie, 'X-CSRF-Token': d.csrf, 'Content-Type': 'application/json' }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined })
    .then(async x => ({ status: x.status, data: await x.json().catch(() => ({})) }));
  session = (await P('session')).data;
});
after(async () => {
  sql(`DELETE FROM squad_profiles WHERE season = '${season}'; DELETE FROM squad_roles WHERE lower(name) LIKE '%${T}%'; DELETE FROM squad_requests WHERE payload_json LIKE '%${T}%';
    UPDATE squad_roles SET category = 'CLUB_STAFF', active = 1 WHERE name = 'Kit Manager';`);
  await adm({ action: 'season', season: prevSeason || '2026/27' });
});

test('tidying and comparing typed roles', () => {
  assert.equal(tidyRole('  assistant   kit-manager '), 'Assistant Kit-Manager');
  assert.equal(tidyRole('GK coach'), 'GK Coach');
  assert.equal(roleKey('Kit-Manager'), roleKey('kit manager'));
});

test('the starting list: coaching and club staff; Goalkeeper Trainer is now Goalkeeper Coach; the portal gets the list', async () => {
  const list = (await roles()).data.roles;
  const names = list.map(r => r.name);
  for (const n of ['Head Coach', 'Goalkeeper Coach', 'Technical Adviser', 'Performance Analyst']) assert.equal(list.find(r => r.name === n).category, 'COACHING', n);
  for (const n of ['Team Manager', 'Kit Manager', 'Welfare Officer', 'Team Secretary', 'Driver']) assert.equal(list.find(r => r.name === n).category, 'CLUB_STAFF', n);
  assert.ok(!names.includes('Goalkeeper Trainer'));
  assert.ok(session.roles.some(r => r.name === 'Goalkeeper Coach' && r.category === 'COACHING'), 'the portal has the list');
  const bad = await staff('Bad', { role: 'Goalkeeper Trainer' });
  assert.ok(bad.save.errors.role, 'a role not on the list is refused');
});

test('"Other" matching an existing role is reused; a new role waits for a Super Admin, then everyone can pick it', async () => {
  kit = await staff('Kit', { role: 'Other', roleOther: '  kit-MANAGER ', roleCoaching: 'No' });
  assert.equal((await P(`profiles/${kit.id}/submit`, 'POST')).status, 200);
  assert.equal((await P(`profiles/${kit.id}`)).data.profile.data.role, 'Kit Manager', 'the existing role is used');
  other = await staff('Vid', { role: 'Other', roleOther: NEW_ROLE.toLowerCase(), roleCoaching: 'Yes' });
  const miss = await staff('Miss', { role: 'Other' });
  const m = await P(`profiles/${miss.id}/submit`, 'POST');
  assert.equal(m.status, 400); assert.ok(m.data.missing.some(x => x.key === 'roleOther') && m.data.missing.some(x => x.key === 'roleCoaching'), 'the role and "coaching?" are required');
  assert.equal((await P(`profiles/${other.id}/submit`, 'POST')).status, 200);
  const it = (await ap()).data.items.find(i => i.kind === 'new_role' && i.payload.role === NEW_ROLE);
  assert.ok(it, 'a New role request'); assert.equal(it.payload.category, 'Coaching staff');
  assert.ok((await roles()).data.roles.some(r => r.name === NEW_ROLE && r.status === 'pending'));
  assert.ok(!(await P('session')).data.roles.some(r => r.name === NEW_ROLE), 'not offered before approval');
  assert.equal((await ap({ action: 'request', requestId: it.requestId, decision: 'approve' })).status, 200);
  assert.ok((await P('session')).data.roles.some(r => r.name === NEW_ROLE), 'offered to everyone');
  assert.equal((await P(`profiles/${other.id}`)).data.profile.data.role, NEW_ROLE, 'the profile uses it');
});

test('only coaching roles are on the Squad page; moving a role moves its people at once; club staff have no page', async () => {
  for (const x of [kit, other]) assert.equal((await ap({ action: 'approve', id: x.id })).status, 200);
  let pub = await fetch(`${BASE}/api/squad/public`).then(r => r.json());
  assert.ok(pub.staff.some(s => s.id === other.id), 'a coaching role is shown');
  assert.ok(!pub.staff.some(s => s.id === kit.id), 'the kit manager is not');
  const kitSlug = `kit-role${T.toLowerCase()}`;
  assert.ok(pub.clubStaff.includes(kitSlug));
  const red = await fetch(`${BASE}/squad/staff/${kitSlug}/`, { redirect: 'manual' });
  assert.equal(red.status, 301); assert.match(red.headers.get('location'), /\/squad\/$/);
  const kitRole = (await roles()).data.roles.find(r => r.name === 'Kit Manager');
  assert.equal((await roles({ action: 'category', id: kitRole.id, category: 'COACHING' })).status, 200);
  pub = await fetch(`${BASE}/api/squad/public`).then(r => r.json());
  assert.ok(pub.staff.some(s => s.id === kit.id), 'on the Squad page straight away');
  await roles({ action: 'category', id: kitRole.id, category: 'CLUB_STAFF' });
});

test('Squad › Roles: rename, order, switch off, merge (the people follow); Super Admins only', async () => {
  let list = (await roles()).data.roles;
  const v = list.find(r => r.name === NEW_ROLE);
  assert.equal((await roles({ action: 'rename', id: v.id, name: `${NEW_ROLE} lead` })).status, 200);
  assert.equal((await P(`profiles/${other.id}`)).data.profile.data.role, tidyRole(`${NEW_ROLE} lead`), 'the profile follows the new name');
  assert.equal((await fetch(`${BASE}/api/squad/public`).then(r => r.json())).staff.find(s => s.id === other.id).role, tidyRole(`${NEW_ROLE} lead`), 'and the live version too');
  const coaching = list.filter(r => r.category === 'COACHING').map(r => r.id).reverse();
  assert.equal((await roles({ action: 'order', ids: coaching })).status, 200);
  assert.equal((await roles()).data.roles.filter(r => r.category === 'COACHING')[0].id, coaching[0]);
  assert.equal((await roles({ action: 'active', id: v.id, active: false })).status, 200);
  assert.ok(!(await P('session')).data.roles.some(r => r.name === tidyRole(`${NEW_ROLE} lead`)), 'switched off: not offered');
  const pa = list.find(r => r.name === 'Performance Analyst');
  const mg = await roles({ action: 'merge', id: v.id, into: pa.id });
  assert.equal(mg.status, 200); assert.equal(mg.data.moved, 1);
  assert.equal((await P(`profiles/${other.id}`)).data.profile.data.role, 'Performance Analyst');
  // put the coaching order back
  await roles({ action: 'order', ids: [...coaching].reverse().filter(id => id !== v.id) });
  list = (await roles()).data.roles;
  assert.ok(!list.some(r => r.id === v.id), 'merged away');
  const email = `roles-${uid()}@example.com`;
  await fetch(`${BASE}/api/admin/staff`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ name: 'Roles Officer', email, password: 'Role-Test-2026!', role: 'matchday_admin' }) });
  const l = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
  assert.equal((await fetch(`${BASE}/api/admin/squad-roles`, { headers: { Cookie: l.headers.get('set-cookie').split(';')[0] } })).status, 403);
});
