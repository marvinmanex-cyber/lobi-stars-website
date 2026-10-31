// Squad Phase 4 (31 Oct 2026): leaving, loans, deletion and former players.
// Requests from the portal wait for a Super Admin; "Out on loan" puts the player in
// the loan section with a banner; "Left the club" makes them FORMER (off /squad, the
// address 301s, still in the partner feed with status "former"); the optional
// Former Players & Legends page; "Delete permanently" (name typed) restorable for 30
// days then erased; a returning person's previous profile restored; the forgiving
// search over current and former people; the scheduled erase date.
// Needs the local Pages dev server (ADMIN_CODE=test-code-123, --r2=SQUAD_BUCKET, LOBI_PARTNER_API_KEY, CRON_SECRET).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nameMatches, checkRequest } from '../functions/api/_lib/squadLifecycle.js';
import { validatePackage, SCHEMA_VERSION } from '../src/lib/squadPackage.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const KEY = process.env.LOBI_PARTNER_API_KEY || 'partner-test-key';
const CRON = { Authorization: `Bearer ${process.env.CRON_SECRET || 'cron-test-secret'}` };
const uid = () => Math.random().toString(36).slice(2, 8);
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const sql = command => {
  const file = path.join(tmpdir(), `squad-lc-${uid()}.sql`);
  writeFileSync(file, command);
  try { return execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--json', '--file', `"${file}"`], { stdio: 'pipe', shell: true }).toString(); }
  finally { rmSync(file, { force: true }); }
};
const T = uid().replace(/\d/g, 'x');
const SUR = `Leave${T}`;
const adm = b => fetch(`${BASE}/api/admin/squad-portal`, { method: b ? 'POST' : 'GET', headers: ADMIN, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const rev = (b, qs = '') => fetch(`${BASE}/api/admin/squad-profiles${qs}`, b ? { method: 'POST', headers: ADMIN, body: JSON.stringify(b) } : { headers: ADMIN }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const ap = (b, qs = '') => fetch(`${BASE}/api/admin/squad-approvals${qs}`, b ? { method: 'POST', headers: ADMIN, body: JSON.stringify(b) } : { headers: ADMIN }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const pub = () => fetch(`${BASE}/api/squad/public`).then(r => r.json());
const photo = () => { const f = new FormData(), j = readFileSync(new URL('../public/images/lobi-stars-badge-print.jpg', import.meta.url)); f.append('kind', 'profile'); for (const k of ['w400', 'w1200', 'jpg']) f.append(k, new Blob([j], { type: 'image/jpeg' }), k); f.append('width', '1200'); f.append('height', '1500'); f.append('warnings', '[]'); return f; };
let P, season, prevSeason, loanee, leaver, mistake;

async function livePlayer(first, num) {
  const id = (await P('profiles', 'POST', { type: 'player' })).data.id;
  await P(`profiles/${id}`, 'PATCH', { commit: true, changes: { surname: SUR, firstName: first, dob: '1997-07-07', nationality: 'NG', shirtNumber: num, positionGroup: 'Midfielder', primaryPosition: 'Central midfielder', preferredFoot: 'Right', phone: '08035551111', emergencyName: 'X', emergencyPhone: '08035552222', confirmAccurate: true, confirmConsent: true } });
  await P(`profiles/${id}/photo`, 'POST', photo());
  assert.equal((await P(`profiles/${id}/submit`, 'POST')).status, 200);
  assert.equal((await ap({ action: 'approve', id })).status, 200);
  return id;
}
const approveReq = async (id, kind) => {
  const it = (await ap()).data.items.find(i => i.profileId === id && i.kind === kind);
  assert.ok(it, `${kind} request listed`);
  return ap({ action: 'request', requestId: it.requestId, decision: 'approve' });
};

before(async () => {
  prevSeason = (await adm()).season;
  season = `20${String(40 + Math.floor(Math.random() * 50))}/${String(Math.floor(Math.random() * 90) + 10)}`;
  await adm({ action: 'username', username: 'squad-lc' }); await adm({ action: 'enabled', enabled: true }); await adm({ action: 'season', season });
  const pw = (await adm({ action: 'new_password' })).password;
  const r = await fetch(`${BASE}/api/squad-portal/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ username: 'squad-lc', password: pw, name: `Grace ${T}` }) });
  const cookie = r.headers.get('set-cookie').match(/ls_squad=[^;]+/)[0], d = await r.json();
  P = (p, method = 'GET', body) => fetch(`${BASE}/api/squad-portal/${p}`, { method, headers: body instanceof FormData ? { Cookie: cookie, 'X-CSRF-Token': d.csrf } : { Cookie: cookie, 'X-CSRF-Token': d.csrf, 'Content-Type': 'application/json' }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined })
    .then(async x => ({ status: x.status, data: await x.json().catch(() => ({})) }));
  loanee = await livePlayer('Lola', 71); leaver = await livePlayer('Tayo', 72); mistake = await livePlayer('Oops', 73);
});
after(async () => {
  sql(`DELETE FROM squad_profiles WHERE surname = '${SUR}' OR season = '${season}'; DELETE FROM squad_requests WHERE submitted_by LIKE '%${T}%'; DELETE FROM squad_portal_settings WHERE key = 'former_page';`);
  const back = () => adm({ action: 'season', season: prevSeason || '2026/27' });
  await back().catch(() => new Promise(r => setTimeout(r, 2000)).then(back)); // see backup-run below
});

test('checking requests; the forgiving name search', () => {
  assert.ok(nameMatches('Musa Adey', 'Musa Adeyemi')); assert.ok(nameMatches('adeyami', 'Musa Adeyemi')); assert.ok(!nameMatches('joe', 'Musa Adeyemi'));
  assert.match(checkRequest('left', {}, { reason: 'Other', date: '2026-10-01' }).error, /Say why/);
  assert.match(checkRequest('loan', {}, { club: 'Kwara United', start: '2026-11-01', until: '2026-10-01' }).error, /expected return/);
  assert.match(checkRequest('delete', { public_name: 'Oops Name' }, { confirm: 'oops' }).error, /Type the name/);
  assert.ok(checkRequest('delete', { public_name: 'Oops Name' }, { confirm: 'oops name' }).payload);
});

test('out on loan: a request, then the loan section and a banner; back from loan', async () => {
  const r = await P(`profiles/${loanee}/request`, 'POST', { kind: 'loan', club: 'Kwara United', start: '2026-11-01', until: '2027-05-31' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await P(`profiles/${loanee}/request`, 'POST', { kind: 'left', reason: 'Transfer', date: '2026-11-01' })).status, 409, 'one request at a time');
  assert.equal((await P(`profiles/${loanee}`)).data.request.kind, 'loan', 'the portal shows it is waiting');
  assert.equal((await approveReq(loanee, 'loan')).status, 200);
  const f = await pub();
  assert.ok(!f.players.some(p => p.id === loanee), 'out of the main squad');
  const l = f.loans.find(p => p.id === loanee);
  assert.equal(l.loan.club, 'Kwara United');
  const slug = l.slug;
  const list = await fetch(`${BASE}/squad/`).then(x => x.text());
  if (list.includes(`Lola`)) assert.match(list, /Out on Loan/);
  await new Promise(r => setTimeout(r, 11000)); // the live squad is cached for 10 seconds
  const page = await fetch(`${BASE}/squad/${slug}/`).then(x => x.text());
  assert.match(page, /On loan at Kwara United/);
  assert.equal((await P(`profiles/${loanee}/request`, 'POST', { kind: 'return' })).status, 200);
  assert.equal((await approveReq(loanee, 'return')).status, 200);
  assert.ok((await pub()).players.some(p => p.id === loanee), 'back in the squad');
});

test('left the club: FORMER, off /squad, address 301s, in the partner feed as "former"; erase date shown', async () => {
  const slug = (await pub()).players.find(p => p.id === leaver).slug;
  assert.equal((await P(`profiles/${leaver}/request`, 'POST', { kind: 'left', reason: 'Transfer', date: '2026-10-30', newClub: 'Enyimba FC' })).status, 200);
  const it = (await ap()).data.items.find(i => i.profileId === leaver && i.kind === 'left');
  assert.ok(it.removal); assert.deepEqual(it.payload.display.find(x => x[0] === 'New club'), ['New club', 'Enyimba FC']);
  assert.equal((await approveReq(leaver, 'left')).status, 200);
  const f = await pub();
  assert.ok(!f.players.some(p => p.id === leaver));
  assert.ok(f.formerSlugs.some(x => x.slug === slug));
  await new Promise(r => setTimeout(r, 11000)); // the live squad is cached for 10 seconds
  const red = await fetch(`${BASE}/squad/${slug}/`, { redirect: 'manual' });
  assert.equal(red.status, 301); assert.match(red.headers.get('location'), /\/squad\/$/);
  const one = (await rev(null, `?id=${leaver}`)).data;
  assert.equal(one.profile.status, 'FORMER'); assert.equal(one.profile.leave.newClub, 'Enyimba FC');
  assert.match(one.eraseOn, /^20\d\d-\d\d-\d\d$/, 'Super Admins see when private details will be erased');
  const doc = await fetch(`${BASE}/api/partner/squad`, { headers: { Authorization: `Bearer ${KEY}` } }).then(x => x.json());
  assert.equal(doc.schemaVersion, SCHEMA_VERSION); assert.equal(SCHEMA_VERSION, '1.4'); assert.deepEqual(validatePackage(doc), []);
  const x = doc.players.find(p => p.id === leaver);
  assert.ok(x, 'still in the partner feed'); assert.equal(x.status, 'former'); assert.equal(x.leaving.reason, 'Transfer'); assert.equal(x.leaving.newClub, 'Enyimba FC');
  // The forgiving search finds former people too (portal and admin).
  const found = (await P(`profiles?filter=former&q=${encodeURIComponent(`tayo ${SUR.slice(0, 6)}`)}`)).data.profiles;
  assert.ok(found.some(p => p.id === leaver));
});

test('the Former Players & Legends page (off by default; on: list and page, old address goes there)', async () => {
  const slug = (await pub()).formerSlugs.find(x => true && x).slug;
  assert.equal((await fetch(`${BASE}/squad/former/`, { redirect: 'manual' })).status, 302, 'off: not shown');
  assert.equal((await rev({ action: 'former_page', on: true })).status, 200);
  const f = await pub();
  assert.ok(f.formerPage && f.former.some(x => x.name.includes('Tayo')));
  await new Promise(r => setTimeout(r, 11000)); // the live squad is cached for 10 seconds
  const list = await fetch(`${BASE}/squad/former/`).then(x => x.text());
  assert.match(list, /Former Players/); assert.match(list, /Tayo/);
  const tayo = f.former.find(x => x.name.includes('Tayo'));
  const page = await fetch(`${BASE}/squad/former/${tayo.slug}/`).then(x => x.text());
  assert.match(page, /Played for Lobi Stars/); assert.ok(!page.includes('08035551111'));
  const red = await fetch(`${BASE}/squad/${tayo.slug}/`, { redirect: 'manual' });
  assert.match(red.headers.get('location'), new RegExp(`/squad/former/${tayo.slug}/$`));
  void slug;
  await rev({ action: 'former_page', on: false });
});

test('a returning person: the previous profile is offered and restored (history kept), the new draft removed', async () => {
  const draft = (await P('profiles', 'POST', { type: 'player' })).data.id;
  const s = await P(`profiles/${draft}`, 'PATCH', { commit: true, changes: { surname: SUR, firstName: 'Tayo', dob: '1997-07-07' } });
  assert.equal(s.data.samePerson?.id, leaver); assert.equal(s.data.samePerson.status, 'FORMER');
  assert.equal((await P(`profiles/${leaver}/request`, 'POST', { kind: 'restore', draftId: draft })).status, 200);
  assert.equal((await approveReq(leaver, 'restore')).status, 200);
  assert.ok((await pub()).players.some(p => p.id === leaver), 'live again');
  assert.equal((await P(`profiles/${draft}`)).status, 404, 'the new draft is gone');
});

test('delete permanently: the name must be typed; restorable for 30 days; then erased', async () => {
  assert.equal((await P(`profiles/${mistake}/request`, 'POST', { kind: 'delete', confirm: 'wrong' })).status, 400);
  assert.equal((await P(`profiles/${mistake}/request`, 'POST', { kind: 'delete', confirm: `oops ${SUR.toLowerCase()}` })).status, 200);
  assert.equal((await approveReq(mistake, 'delete')).status, 200);
  assert.ok(!(await pub()).players.some(p => p.id === mistake), 'gone everywhere');
  let d = (await rev(null, '?filter=all')).data.deleted;
  assert.ok(d.some(x => x.id === mistake), 'in Deleted profiles');
  assert.equal((await rev({ action: 'restore_deleted', id: mistake })).data.status, 'LIVE');
  assert.ok((await pub()).players.some(p => p.id === mistake), 'back');
  // A Super Admin's own delete is applied at once; after 30 days the daily job erases it.
  assert.equal((await rev({ action: 'lifecycle', id: mistake, kind: 'delete', confirm: `Oops ${SUR}` })).status, 200);
  sql(`UPDATE squad_profiles SET deleted_at = '${new Date(Date.now() - 31 * 864e5).toISOString()}' WHERE id = '${mistake}'; DELETE FROM squad_portal_settings WHERE key = 'retention_day';`);
  // (locally, the first request after editing the database file directly can be dropped: try twice)
  const once = () => fetch(`${BASE}/api/internal/backup-run`, { method: 'POST', headers: CRON }).then(x => x.json());
  const run = await once().catch(() => new Promise(r => setTimeout(r, 2000)).then(once));
  assert.ok(run.privacy.purged >= 1, JSON.stringify(run.privacy));
  const left = JSON.parse(sql(`SELECT COUNT(*) AS n FROM squad_profiles WHERE id = '${mistake}';`))[0].results[0].n;
  assert.equal(left, 0, 'erased for good');
});
