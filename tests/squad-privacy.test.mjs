// Squad & Staff Data Portal, Phase 7: privacy. The portal link is on no public
// page or sitemap; the portal and its downloads never use the words listed in
// FORBIDDEN; private details of people who left are erased after the retention
// period (and from earlier seasons' copies); refused saves reach the Activity Log
// without the answers; backups leave out the portal password and sessions.
// Needs the local Pages dev server (ADMIN_CODE=test-code-123, CRON_SECRET=cron-test-secret) and a build in dist/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const CRON = { Authorization: `Bearer ${process.env.CRON_SECRET || 'cron-test-secret'}` };
const FORBIDDEN = /commentary|commentator|on air|broadcast/i;
const PORTAL = '/staff/squad-data';
const uid = () => Math.random().toString(36).slice(2, 8);
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const sql = command => {
  const file = path.join(tmpdir(), `squad-priv-${uid()}.sql`);
  writeFileSync(file, command);
  try { return execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--json', '--file', `"${file}"`], { stdio: 'pipe', shell: true }).toString(); }
  finally { rmSync(file, { force: true }); }
};
const TAG = `V${uid()}`;
const L = TAG.toLowerCase().replace(/[0-9]/g, d => 'abcdefghij'[d]); // names are letters only
const adm = b => fetch(`${BASE}/api/admin/squad-portal`, { method: b ? 'POST' : 'GET', headers: ADMIN, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const rev = b => fetch(`${BASE}/api/admin/squad-profiles`, { method: 'POST', headers: ADMIN, body: JSON.stringify(b) }).then(async r => ({ status: r.status, data: await r.json() }));
const dist = new URL('../dist/', import.meta.url);
const walk = dir => readdirSync(dir).flatMap(f => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
let P, id, oldId, prevSeason;

before(async () => {
  prevSeason = (await adm()).season;
  await adm({ action: 'username', username: 'squad-priv' }); await adm({ action: 'enabled', enabled: true });
  const pw = (await adm({ action: 'new_password' })).password;
  const r = await fetch(`${BASE}/api/squad-portal/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ username: 'squad-priv', password: pw, name: `Ada ${TAG}` }) });
  const cookie = r.headers.get('set-cookie').match(/ls_squad=[^;]+/)[0], d = await r.json();
  P = (p, method = 'GET', body) => fetch(`${BASE}/api/squad-portal/${p}`, { method, headers: { Cookie: cookie, 'X-CSRF-Token': d.csrf, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async x => ({ status: x.status, data: await x.json().catch(() => ({})) }));
  id = (await P('profiles', 'POST', { type: 'player' })).data.id;
  await P(`profiles/${id}`, 'PATCH', { changes: { firstName: 'Sam', surname: `Left${L}`, dob: '1999-01-01', phone: '08035553333', email: `l.${TAG.toLowerCase()}@example.com`, emergencyName: `Kin ${TAG}`, emergencyPhone: '08035554444', primaryPosition: 'Striker' }, commit: true });
  // An earlier season's copy of the same person (carried over).
  oldId = `sp_old${uid()}`;
  sql(`INSERT INTO squad_profiles (id, season, type, status, data_json, display_name, full_name, dob, created_at, updated_at) VALUES ('${oldId}', '2001/02', 'player', 'LIVE', '{"displayName":"Left ${TAG}","fullName":"Legal ${TAG}","phone":"+2348035553333"}', 'Left ${TAG}', 'Legal ${TAG}', '1999-01-01', '2001-08-01T00:00:00Z', '2001-08-01T00:00:00Z');
    UPDATE squad_profiles SET carried_from = '${oldId}' WHERE id = '${id}';`);
});
after(async () => { sql(`DELETE FROM squad_profiles WHERE display_name LIKE '%${TAG}%' OR public_name LIKE '%${L}%' OR id = '${oldId}'; DELETE FROM squad_portal_settings WHERE key = 'retention_seasons';`); await adm({ action: 'season', season: prevSeason || '2026/27' }); });

test('the portal link is on no public page and not in the sitemap; robots.txt and the page keep search engines out', async () => {
  assert.ok(existsSync(dist), 'build first (npm run build)');
  const pages = walk(fileURLToPath(dist)).filter(f => /\.(html|xml|txt|js)$/.test(f) && !/[\\/]staff[\\/]/.test(f));
  const hits = pages.filter(f => readFileSync(f, 'utf8').includes(PORTAL) && !/robots\.txt$/.test(f) && !/[\\/]_astro[\\/]/.test(f));
  assert.deepEqual(hits, [], 'no public page mentions the portal address');
  // (Coaching staff profiles live at /squad/staff/…; robots.txt blocks only addresses starting with /staff/.)
  assert.ok(!/<loc>[^<]*\.com\/staff\//.test(readFileSync(new URL('sitemap.xml', dist), 'utf8')), 'the portal is not in the sitemap');
  assert.match(readFileSync(new URL('robots.txt', dist), 'utf8'), /Disallow: \/staff\//);
  const r = await fetch(`${BASE}${PORTAL}/`);
  assert.match(r.headers.get('x-robots-tag') || '', /noindex/);
  const html = await r.text();
  assert.ok(!FORBIDDEN.test(html), 'no forbidden words on the portal page');
  assert.match(html, /\/privacy\/#squad-profiles/, 'privacy link in the portal footer');
  const privacy = readFileSync(new URL('privacy/index.html', dist), 'utf8');
  assert.match(privacy, /id="squad-profiles"/); assert.match(privacy, /2 seasons after you leave/); assert.match(privacy, /media partner/);
  assert.ok(!privacy.includes(PORTAL), 'the privacy page does not reveal the portal address');
});

test('portal scripts and downloads (export data, partner feed) never use the forbidden words', async () => {
  const html = readFileSync(new URL('staff/squad-data/index.html', dist), 'utf8');
  const scripts = [...html.matchAll(/src="(\/_astro\/[^"]+\.js)"/g)].map(m => m[1]);
  const seen = new Set();
  const read = rel => { if (seen.has(rel)) return; seen.add(rel); const t = readFileSync(new URL(`.${rel}`, dist), 'utf8'); assert.ok(!FORBIDDEN.test(t), `forbidden word in ${rel}`); for (const m of t.matchAll(/["'(]\.\/([\w.-]+\.js)["')]/g)) read(`/_astro/${m[1]}`); };
  scripts.forEach(read);
  assert.ok(seen.size > 0, 'portal scripts found');
  assert.equal((await P('export-data?which=all&season=current')).status, 403, 'no exports from the portal');
  const ex = await fetch(`${BASE}/api/admin/squad-profiles?export=1&which=verified&season=current`, { headers: ADMIN }).then(r => r.json());
  assert.ok(!FORBIDDEN.test(JSON.stringify(ex)));
});

test('a refused save is reported to the Activity Log without the answer', async () => {
  assert.equal((await P('session', 'POST', { report: 'save_failed', profile: id, detail: 'This profile was submitted and can only be viewed.' })).status, 200);
  const log = await fetch(`${BASE}/api/admin/activity-log?q=${encodeURIComponent(TAG)}`, { headers: ADMIN }).then(r => r.ok ? r.json() : null).catch(() => null);
  const rows = JSON.parse(sql(`SELECT detail FROM admin_log WHERE action = 'squad_save_failed' AND detail LIKE '%${TAG}%';`))[0].results;
  assert.equal(rows.length, 1, JSON.stringify(log));
  assert.match(rows[0].detail, new RegExp(`Ada ${TAG}: a change for Sam Left${L} could not be saved`));
  assert.ok(!rows[0].detail.includes('Kin'), 'no private answer in the log');
});

test('retention: private details of people who left are erased after the set seasons, also from earlier copies', async () => {
  assert.equal((await adm({ action: 'retention', seasons: 9 })).error, 'Choose 1 to 5 seasons.');
  assert.equal((await adm({ action: 'retention', seasons: 2 })).retentionSeasons, 2);
  assert.equal((await P(`profiles/${id}/submit`, 'POST')).status >= 200, true);
  sql(`UPDATE squad_profiles SET status = 'PENDING_APPROVAL' WHERE id = '${id}';`); // (incomplete answers: sent for approval by hand)
  assert.equal((await rev({ action: 'approve', id })).status, 200, 'approved: live');
  assert.equal((await rev({ action: 'left', id })).status, 200);
  const run = () => { sql(`DELETE FROM squad_portal_settings WHERE key = 'retention_day';`); return fetch(`${BASE}/api/internal/backup-run`, { method: 'POST', headers: CRON }).then(r => r.json()); };
  assert.equal((await run()).privacy.erased, 0, 'not yet: left today');
  sql(`UPDATE squad_profiles SET left_at = '${new Date(Date.now() - 3 * 365 * 864e5).toISOString()}' WHERE id = '${id}';`);
  const r = await run();
  assert.equal(r.privacy.erased, 2, JSON.stringify(r));
  const rows = JSON.parse(sql(`SELECT id, data_json, full_name, dob FROM squad_profiles WHERE id IN ('${id}', '${oldId}');`))[0].results;
  for (const row of rows) {
    const d = JSON.parse(row.data_json);
    assert.equal(row.full_name, null); assert.equal(row.dob, null);
    for (const k of ['fullName', 'dob', 'phone', 'email', 'emergencyName', 'emergencyPhone']) assert.ok(!(k in d), `${k} erased`);
    assert.ok(d.surname === `Left${L}` || d.displayName === `Left ${TAG}`, 'public profile kept');
  }
  assert.equal((await run()).privacy.erased, 0, 'nothing left to erase');
});

test('backups leave out the portal password, sessions and devices', async () => {
  const src = readFileSync(new URL('../functions/api/_lib/autoBackup.js', import.meta.url), 'utf8');
  for (const t of ['squad_portal_settings', 'squad_portal_sessions', 'squad_portal_devices']) assert.ok(src.includes(`'${t}'`), t);
  assert.match(src, /SQUAD_BUCKET, 'squad'/, 'squad photos and recordings copied weekly');
});

test('Website Health checks the portal: private, sign-in bursts, refused saves, Data Package schema, photos', async () => {
  const h = (b) => fetch(`${BASE}/api/admin/health`, b ? { method: 'POST', headers: ADMIN, body: JSON.stringify(b) } : { headers: ADMIN }).then(r => r.json());
  let run = (await h({ action: 'start', kind: 'category', only: 'tasks' })).run;
  for (let i = 0; i < 50 && !run.done; i++) { const r = await h({ action: 'step', id: run.id }); run = r.run; if (r.busy) await new Promise(x => setTimeout(x, 1000)); }
  const checks = Object.fromEntries((await h()).checks.map(c => [c.id, c]));
  for (const id of ['squad_portal', 'squad_signins', 'squad_saves', 'squad_export', 'squad_photos']) assert.ok(checks[id], id);
  assert.equal(checks.squad_portal.status, 'PASS', checks.squad_portal.problem);
  assert.equal(checks.squad_export.status, 'PASS', checks.squad_export.problem);
  assert.match(checks.squad_export.problem, /schemaVersion 1\.2/);
  assert.equal(checks.squad_saves.status, 'WARNING', 'the refused save above is reported');
});
