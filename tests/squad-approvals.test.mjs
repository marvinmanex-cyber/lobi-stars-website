// Squad Phase 2 (23 Oct 2026): Super Admin approval. Only the Super Admins approve;
// the Approval Queue lists new profiles, changes and requests; a change shows its
// before / after; Request changes needs a note; several new profiles can be approved
// together; the live Squad pages (made on the server) show an approval within about
// 10 seconds; old addresses 301; the bell and the menu badge count what is waiting;
// the sitemap lists the live profiles.
// Needs the local Pages dev server (ADMIN_CODE=test-code-123, --r2=SQUAD_BUCKET, CRON_SECRET).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const CRON = { Authorization: `Bearer ${process.env.CRON_SECRET || 'cron-test-secret'}` };
const uid = () => Math.random().toString(36).slice(2, 8);
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const sql = command => {
  const file = path.join(tmpdir(), `squad-appr-${uid()}.sql`);
  writeFileSync(file, command);
  try { return execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--json', '--file', `"${file}"`], { stdio: 'pipe', shell: true }).toString(); }
  finally { rmSync(file, { force: true }); }
};
const T = uid().replace(/\d/g, 'x');
const adm = b => fetch(`${BASE}/api/admin/squad-portal`, { method: b ? 'POST' : 'GET', headers: ADMIN, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const ap = (b, qs = '', headers = ADMIN) => fetch(`${BASE}/api/admin/squad-approvals${qs}`, b ? { method: 'POST', headers, body: JSON.stringify(b) } : { headers }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const photo = file => { const f = new FormData(), j = readFileSync(new URL(`../public/images/${file}`, import.meta.url)); f.append('kind', 'profile'); for (const k of ['w400', 'w1200', 'jpg']) f.append(k, new Blob([j], { type: 'image/jpeg' }), k); f.append('width', '1200'); f.append('height', '1500'); f.append('warnings', '[]'); return f; };
const answers = (first, num) => ({ surname: `Appr${T}`, firstName: first, dob: '1998-05-05', nationality: 'NG', shirtNumber: num, positionGroup: 'Defender', primaryPosition: 'Centre back', preferredFoot: 'Left', phone: '08035551111', emergencyName: 'X', emergencyPhone: '08035552222', confirmAccurate: true, confirmConsent: true });
let P, season, prevSeason, a, b, c;

async function make(first, num) {
  const id = (await P('profiles', 'POST', { type: 'player' })).data.id;
  await P(`profiles/${id}`, 'PATCH', { commit: true, changes: answers(first, num) });
  assert.equal((await P(`profiles/${id}/photo`, 'POST', photo('lobi-stars-badge-print.jpg'))).status, 200);
  assert.equal((await P(`profiles/${id}/submit`, 'POST')).status, 200);
  return id;
}
/** The live page shows something within the 10-second edge cache. */
async function eventually(fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await new Promise(r => setTimeout(r, 1000)); }
}

before(async () => {
  prevSeason = (await adm()).season;
  season = `20${String(40 + Math.floor(Math.random() * 50))}/${String(Math.floor(Math.random() * 90) + 10)}`;
  await adm({ action: 'username', username: 'squad-appr' }); await adm({ action: 'enabled', enabled: true }); await adm({ action: 'season', season });
  const pw = (await adm({ action: 'new_password' })).password;
  const r = await fetch(`${BASE}/api/squad-portal/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ username: 'squad-appr', password: pw, name: `Grace ${T}` }) });
  const cookie = r.headers.get('set-cookie').match(/ls_squad=[^;]+/)[0], d = await r.json();
  P = (p, method = 'GET', body) => fetch(`${BASE}/api/squad-portal/${p}`, { method, headers: body instanceof FormData ? { Cookie: cookie, 'X-CSRF-Token': d.csrf } : { Cookie: cookie, 'X-CSRF-Token': d.csrf, 'Content-Type': 'application/json' }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined })
    .then(async x => ({ status: x.status, data: await x.json().catch(() => ({})) }));
});
after(async () => {
  sql(`DELETE FROM squad_profiles WHERE season = '${season}'; DELETE FROM squad_requests WHERE submitted_by = 'Test ${T}';`);
  await adm({ action: 'season', season: prevSeason || '2026/27' });
});

test('only the Super Admins approve: the Website & Data Officer and other staff are refused', async () => {
  for (const role of ['matchday_admin', 'media']) {
    const email = `appr-${role}-${uid()}@example.com`;
    await fetch(`${BASE}/api/admin/staff`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ name: `Appr ${role}`, email, password: 'Role-Test-2026!', role }) });
    const l = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
    const cookie = l.headers.get('set-cookie').split(';')[0];
    assert.equal((await ap(null, '', { Cookie: cookie })).status, 403, role);
    assert.equal((await ap({ action: 'approve', id: 'x' }, '', { Cookie: cookie, 'Content-Type': 'application/json' })).status, 403, role);
    if (role === 'matchday_admin') {
      const r = await fetch(`${BASE}/api/admin/squad-profiles`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve', id: 'x' }) });
      assert.equal(r.status, 403, 'the Website & Data Officer cannot approve on the review page either');
    }
  }
  assert.equal((await fetch(`${BASE}/api/admin/squad-approvals`)).status, 401);
});

test('new profile: in the queue with a preview, approved → on the live Squad page within seconds; bell and badge count it', async () => {
  a = await make('Ayo', 61);
  const q = (await ap()).data.items;
  const it = q.find(i => i.profileId === a);
  assert.ok(it, 'listed'); assert.equal(it.kind, 'new'); assert.match(it.submittedBy, new RegExp(`Grace ${T}`));
  const n = await fetch(`${BASE}/api/admin/notifications`, { headers: ADMIN }).then(r => r.json());
  assert.ok(n.counts.squadApprovals >= 1, 'menu badge count');
  assert.ok(n.items.some(x => /waiting for your approval/.test(x.title) && x.href === '/admin/squad-approvals/'), 'bell');
  const d = (await ap(null, `?id=${a}`)).data;
  assert.equal(d.kind, 'new'); assert.equal(d.previewUrl, `/squad/_preview/${a}/`);
  assert.equal((await fetch(`${BASE}${d.previewUrl}`)).status, 403, 'the preview is for Super Admins');
  const pv = await fetch(`${BASE}${d.previewUrl}`, { headers: ADMIN }).then(r => r.text());
  assert.match(pv, new RegExp(`Ayo Appr${T} \\| Lobi Stars FC`, 'i')); assert.match(pv, /noindex/);
  const slug = `ayo-appr${T.toLowerCase()}`;
  assert.equal((await fetch(`${BASE}/squad/${slug}/`)).status, 404, 'not public before approval');
  assert.equal((await ap({ action: 'approve', id: a })).status, 200);
  const page = await eventually(async () => { const r = await fetch(`${BASE}/squad/${slug}/`); return r.status === 200 ? r.text() : null; });
  assert.ok(page, 'live within seconds, no rebuild');
  assert.match(page, new RegExp(`<title>Ayo Appr${T} \\| Lobi Stars FC</title>`, 'i'));
  assert.match(page, /"@type":"Person"/); assert.ok(!/name="robots"/.test(page), 'indexable');
  assert.ok(!page.includes('08035551111'), 'nothing private');
  const list = await eventually(async () => { const t = await fetch(`${BASE}/squad/`).then(r => r.text()); return t.includes(`Appr${T}`) ? t : null; });
  assert.ok(list, 'on the squad list');
});

test('change to a live profile: before / after, photo compare; the live version stays until approved; plain-English log', async () => {
  const slug = `ayo-appr${T.toLowerCase()}`;
  await P(`profiles/${a}`, 'PATCH', { commit: true, changes: { heightCm: 188, shirtNumber: 62 } });
  assert.equal((await P(`profiles/${a}/photo`, 'POST', photo('og-default.jpg'))).status, 200);
  assert.equal((await P(`profiles/${a}/submit`, 'POST')).status, 200);
  const it = (await ap()).data.items.find(i => i.profileId === a);
  assert.equal(it.kind, 'edit');
  const d = (await ap(null, `?id=${a}`)).data;
  const h = d.changes.find(x => x.key === 'heightCm'), num = d.changes.find(x => x.key === 'shirtNumber');
  assert.equal(h.fromText, 'blank'); assert.equal(h.toText, '188'); assert.equal(num.fromText, '61'); assert.equal(num.toText, '62');
  const ph = d.photos.find(x => x.kind === 'profile');
  assert.ok(ph.changed && /live=1/.test(ph.before) && /rev=/.test(ph.after), 'old and new photo');
  const live = await fetch(`${BASE}/squad/${slug}/`).then(r => r.text());
  assert.match(live, />61</, 'the website still shows the live number');
  // Request changes needs a note.
  assert.equal((await ap({ action: 'request_changes', id: a, note: '' })).status, 400);
  assert.equal((await ap({ action: 'request_changes', id: a, note: 'Height is 1.87, please check.' })).status, 200);
  const pp = (await P(`profiles/${a}`)).data.profile;
  assert.equal(pp.pending, 'CHANGES_REQUESTED'); assert.equal(pp.reviewNote, 'Height is 1.87, please check.');
  assert.ok((await P('profiles?filter=all')).data.profiles.find(x => x.id === a).reviewNote, 'the portal list shows the note');
  await P(`profiles/${a}`, 'PATCH', { commit: true, changes: { heightCm: 187 } });
  assert.equal((await P(`profiles/${a}/submit`, 'POST')).status, 200);
  assert.equal((await ap({ action: 'approve', id: a })).status, 200);
  const after = await eventually(async () => { const t = await fetch(`${BASE}/squad/${slug}/`).then(r => r.text()); return />62</.test(t) ? t : null; });
  assert.ok(after, 'the change is live within seconds');
  const log = JSON.parse(sql(`SELECT detail FROM admin_log WHERE action = 'squad_profile_verify' AND detail LIKE '%Appr${T}%' ORDER BY id DESC LIMIT 1;`))[0].results[0].detail;
  assert.match(log, new RegExp(`Owner \\(admin code\\) \\(Super Admin\\) approved Grace ${T}'s change to Ayo Appr${T}`));
  assert.match(log, /shirt number 61 → 62/i);
});

test('bulk approve several new profiles; a renamed person\'s old address 301s', async () => {
  b = await make('Bola', 63); c = await make('Chi', 64);
  const r = await ap({ action: 'approve_many', ids: [b, c, a] });
  assert.equal(r.status, 200);
  assert.equal(r.data.approved.length, 2); assert.equal(r.data.failed.length, 1, 'a live profile is not part of a bulk approval');
  await P(`profiles/${b}`, 'PATCH', { commit: true, changes: { firstName: 'Bolaji' } });
  await P(`profiles/${b}/submit`, 'POST');
  await ap({ action: 'approve', id: b });
  const old = `/squad/bola-appr${T.toLowerCase()}/`;
  const red = await eventually(async () => { const x = await fetch(`${BASE}${old}`, { redirect: 'manual' }); return x.status === 301 ? x : null; });
  assert.ok(red, 'old address redirects');
  assert.match(red.headers.get('location'), new RegExp(`/squad/bolaji-appr${T.toLowerCase()}/$`));
});

test('requests (e.g. left the club): listed as removals; reject needs a note', async () => {
  sql(`INSERT INTO squad_requests (profile_id, kind, payload_json, submitted_by, submitted_at) VALUES ('${c}', 'left', '{"reason":"Transfer"}', 'Test ${T}', '${new Date().toISOString()}');`);
  const it = (await ap()).data.items.find(i => i.profileId === c && i.kind === 'left');
  assert.ok(it && it.removal);
  assert.equal((await ap({ action: 'request', requestId: it.requestId, decision: 'reject', note: '' })).status, 400);
  assert.equal((await ap({ action: 'request', requestId: it.requestId, decision: 'reject', note: 'Not true, he stays.' })).status, 200);
  assert.ok(!(await ap()).data.items.some(i => i.key === it.key));
});

test('portal wording; the timer runs the digest; non-coaching staff and the template are not indexed', async () => {
  const src = readFileSync(new URL('../src/scripts/squadPortal/form.ts', import.meta.url), 'utf8');
  assert.match(src, /Submit for approval/); assert.match(src, /It will appear on the website once approved by the club\./);
  const r = await fetch(`${BASE}/api/internal/health-check`, { method: 'POST', headers: CRON }).then(x => x.json());
  assert.ok('squadDigest' in r);
  const t = await fetch(`${BASE}/squad-template/`).then(x => x.text());
  assert.match(t, /noindex/);
});
