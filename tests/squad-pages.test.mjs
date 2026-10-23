// Squad names and profile pages (22 Oct 2026): the form (surname / first name /
// middle name; display name and pronunciation gone), the Super Admin name check,
// editing (club-only fields, duplicate shirt number warning, hide), what reaches
// the website and the partner feed (never private details; full date of birth only
// from 18), season stats, "Draft bio with Claude" (preview only), and finally the
// built pages (squad list, player and coach profiles).
// Needs the local Pages dev server (ADMIN_CODE=test-code-123, LOBI_PARTNER_API_KEY=partner-test-key,
// ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL=http://127.0.0.1:8899/v1: this test answers as Claude).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync, execSync } from 'node:child_process';
import { writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePackage, SCHEMA_VERSION } from '../src/lib/squadPackage.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const KEY = process.env.LOBI_PARTNER_API_KEY || 'partner-test-key';
const uid = () => Math.random().toString(36).slice(2, 8);
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const sql = command => {
  const file = path.join(tmpdir(), `squad-pages-${uid()}.sql`);
  writeFileSync(file, command);
  try { return execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--json', '--file', `"${file}"`], { stdio: 'pipe', shell: true }).toString(); }
  finally { rmSync(file, { force: true }); }
};
const T = uid().replace(/\d/g, 'x');
const SUR = `Okon${T}`, KID = `Ade${T}`, COACH = `Iorliam${T}`;
const adm = b => fetch(`${BASE}/api/admin/squad-portal`, { method: b ? 'POST' : 'GET', headers: ADMIN, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const rev = (b, qs = '') => fetch(`${BASE}/api/admin/squad-profiles${qs}`, b ? { method: 'POST', headers: ADMIN, body: JSON.stringify(b) } : { headers: ADMIN }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
let P, season, prevSeason, adult, minor, coach, staffer, oldId, claudeAsked = [], server;
const photo = () => { const f = new FormData(), j = readFileSync(new URL('../public/images/lobi-stars-badge-print.jpg', import.meta.url)); f.append('kind', 'profile'); for (const k of ['w400', 'w1200', 'jpg']) f.append(k, new Blob([j], { type: 'image/jpeg' }), k); f.append('width', '1200'); f.append('height', '1500'); f.append('warnings', '[]'); return f; };
const base = { phone: '08035551111', emergencyName: 'Mama Test', emergencyPhone: '08035552222', confirmAccurate: true, confirmConsent: true };

before(async () => {
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      claudeAsked.push(raw);
      const text = JSON.stringify({ headline: 'Composed defender', bio: `${SUR} is a composed centre back who joined Lobi Stars from Kwara United.\n\nHe was born in Makurdi.`, missing: 'How he joined the club.' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 300, output_tokens: 120 } }));
    });
  });
  await new Promise(r => server.listen(8899, '127.0.0.1', r));
  prevSeason = (await adm()).season;
  season = `20${String(40 + Math.floor(Math.random() * 50))}/${String(Math.floor(Math.random() * 90) + 10)}`;
  await adm({ action: 'username', username: 'squad-pages' }); await adm({ action: 'enabled', enabled: true }); await adm({ action: 'season', season });
  const pw = (await adm({ action: 'new_password' })).password;
  const r = await fetch(`${BASE}/api/squad-portal/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ username: 'squad-pages', password: pw, name: `Tester ${T}` }) });
  const cookie = r.headers.get('set-cookie').match(/ls_squad=[^;]+/)[0], d = await r.json();
  P = (p, method = 'GET', body) => fetch(`${BASE}/api/squad-portal/${p}`, { method, headers: body instanceof FormData ? { Cookie: cookie, 'X-CSRF-Token': d.csrf } : { Cookie: cookie, 'X-CSRF-Token': d.csrf, 'Content-Type': 'application/json' }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined })
    .then(async x => ({ status: x.status, data: await x.json().catch(() => ({})) }));
  const make = async (type, changes) => {
    const id = (await P('profiles', 'POST', { type })).data.id;
    const s = await P(`profiles/${id}`, 'PATCH', { changes: { ...base, ...changes }, commit: true, type });
    assert.deepEqual(s.data.errors, {}, JSON.stringify(s.data.errors));
    await P(`profiles/${id}/photo`, 'POST', photo());
    return id;
  };
  adult = await make('player', { surname: SUR.toUpperCase(), firstName: 'chidi', middleName: 'Emeka', dob: '1998-03-14', nationality: 'NG', nationality2: 'GB', birthTown: 'Makurdi', birthCountry: 'NG', shirtNumber: 5, positionGroup: 'Defender', primaryPosition: 'Centre back', preferredFoot: 'Right', heightCm: 186,
    previousClubs: [{ club: 'Kwara United', country: 'NG', startYear: 2019, endYear: 2023 }], internationalCareer: [{ level: 'U20', caps: 4, goals: 1, tournaments: 'U-20 AFCON 2017' }], interestingFact: 'He plays the talking drum.', nationalTeam: 'NG', socialInstagram: 'https://instagram.com/okon_test' });
  minor = await make('player', { surname: KID, firstName: 'Tunde', middleName: 'Secret', dob: '2011-01-20', nationality: 'NG', shirtNumber: 17, positionGroup: 'Forward', preferredFoot: 'Left', guardianName: 'Guardian', guardianPhone: '08035553333', guardianConsent: true });
  coach = await make('staff', { surname: COACH, firstName: 'Terver', middleName: 'Hidden', dob: '1975-06-01', nationality: 'NG', role: 'Head Coach', qualifications: 'CAF A Licence', previousRoles: [{ club: 'Kano Pillars', position: 'Assistant Coach', period: '2018–2022' }], interestingFact: 'He referees on Sundays.' });
  staffer = await make('staff', { surname: `Kit${T}`, firstName: 'Ada', dob: '1985-06-01', nationality: 'NG', role: 'Kit Manager', interestingFact: 'She sews every badge by hand.' });
  for (const id of [adult, minor, coach, staffer]) { assert.equal((await P(`profiles/${id}/submit`, 'POST')).status, 200); assert.equal((await rev({ action: 'verify', id })).status, 200); }
});
after(async () => {
  server?.close();
  sql(`DELETE FROM squad_profiles WHERE season = '${season}' OR id = '${oldId}';`);
  await adm({ action: 'season', season: prevSeason || '2026/27' });
});

test('portal form: names tidied; display name, pronunciation and club-only fields refused; recordings gone (410)', async () => {
  const p = (await P(`profiles/${adult}`)).data.profile;
  assert.equal(p.data.surname, SUR, 'capitals tidied'); assert.equal(p.data.firstName, 'Chidi'); assert.equal(p.name, `Chidi ${SUR}`);
  assert.equal(p.data.socialInstagram, '@okon_test', 'a link becomes the handle');
  assert.match(p.fileBase, new RegExp(`^05-chidi-${SUR.toLowerCase()}$`));
  // A live profile can be edited in the portal (as a change waiting for approval); club-only and retired fields never.
  const r = await P(`profiles/${minor}`, 'PATCH', { changes: { displayName: 'X', pronunciation: 'Y', websiteName: 'Z', bio: 'W' }, commit: true });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.data.errors).sort(), ['bio', 'displayName', 'pronunciation', 'websiteName']);
  const draft = (await P('profiles', 'POST', { type: 'player' })).data.id;
  const e = (await P(`profiles/${draft}`, 'PATCH', { changes: { displayName: 'X', pronunciation: 'Y', websiteName: 'Z', bio: 'W', surname: 'Ok' }, commit: true })).data;
  assert.deepEqual(Object.keys(e.errors).sort(), ['bio', 'displayName', 'pronunciation', 'websiteName']);
  assert.equal(e.saved.surname, 'Ok');
  const miss = await P(`profiles/${draft}/submit`, 'POST');
  assert.equal(miss.status, 400); assert.ok(miss.data.missing.some(m => m.key === 'firstName')); assert.ok(!miss.data.missing.some(m => m.key === 'middleName'));
  assert.equal((await P(`profiles/${draft}/audio`, 'POST', new FormData())).status, 410);
  assert.equal((await fetch(`${BASE}/staff/squad-data/`).then(x => x.headers.get('permissions-policy'))).includes('microphone=()'), true, 'no microphone any more');
});

test('migration: old single names are filled in (Nigerian order only where clear) and marked "Please check name order" until a Super Admin confirms', async () => {
  oldId = `sp_old${T}`;
  const at = new Date().toISOString();
  sql(`INSERT INTO squad_profiles (id, season, type, status, data_json, display_name, full_name, dob, shirt_number, name_status, created_at, updated_at, submitted_at)
    VALUES ('${oldId}', '${season}', 'player', 'PENDING_APPROVAL', '{"fullName":"Bello Musa Ibrahim","displayName":"Musa Bello","dob":"2000-01-01","nationality":"NG","shirtNumber":30,"positionGroup":"Midfielder","preferredFoot":"Left","phone":"+2348031111111","emergencyName":"x","emergencyPhone":"+2348032222222","confirmAccurate":true,"confirmConsent":true}', 'Musa Bello', 'Bello Musa Ibrahim', '2000-01-01', 30, 'pending', '${at}', '${at}', '${at}');`);
  const list = (await rev(null, '?names=1')).data.names;
  const row = list.find(n => n.id === oldId);
  assert.ok(row, 'listed under "Please check name order"');
  assert.deepEqual([row.surname, row.firstName, row.middleName], ['Bello', 'Musa', 'Ibrahim'], 'surname first, as the old full name clearly used it');
  assert.match(row.rule, /surname/);
  const flagged = (await rev(null, `?id=${oldId}`)).data.profile;
  assert.equal(flagged.nameStatus, 'check'); assert.equal(flagged.name, 'Musa Bello'); assert.equal(flagged.data.fullName, 'Bello Musa Ibrahim', 'the old answer is kept');
  assert.ok((await P(`profiles?season=${encodeURIComponent(season)}&filter=all`)).data.profiles.find(x => x.id === oldId).nameStatus === 'check', 'the portal shows it too');
  assert.equal((await rev({ action: 'confirm_name', id: oldId, surname: 'Bello', firstName: '' })).status, 400);
  assert.equal((await rev({ action: 'confirm_name', id: oldId, surname: 'Bello', firstName: 'Musa', middleName: 'Ibrahim', websiteName: '' })).status, 200);
  assert.ok(!(await rev(null, '?names=1')).data.names.some(n => n.id === oldId));
  assert.equal((await rev(null, `?id=${oldId}`)).data.profile.nameStatus, 'confirmed');
  assert.equal((await rev({ action: 'verify', id: oldId })).status, 200);
});

test('duplicate person: surname + first name + date of birth, capitals ignored', async () => {
  const dup = (await P('profiles', 'POST', { type: 'player' })).data.id;
  const r = await P(`profiles/${dup}`, 'PATCH', { changes: { surname: SUR.toLowerCase(), firstName: 'CHIDI', dob: '1998-03-14' }, commit: true });
  assert.equal(r.data.samePerson?.id, adult);
  const other = await P(`profiles/${dup}`, 'PATCH', { changes: { dob: '1998-03-15' }, commit: true });
  assert.equal(other.data.samePerson, null, 'another date of birth is another person');
  await P(`profiles/${dup}`, 'DELETE');
});

test('versions: each approval is a live version; an earlier one can be restored (through approval); an edit can be discarded', async () => {
  const v = (await rev(null, `?versions=${minor}`)).data.versions;
  assert.equal(v.length, 1); assert.equal(v[0].n, 1);
  await rev({ action: 'edit', id: minor, changes: { interestingFact: 'Version two fact.' } });
  assert.equal((await rev({ action: 'approve', id: minor })).data.n, 2);
  assert.equal((await rev(null, `?versions=${minor}`)).data.versions.length, 2);
  assert.equal((await rev({ action: 'restore_version', id: minor, n: 1 })).status, 200);
  const p = (await rev(null, `?id=${minor}`)).data.profile;
  assert.equal(p.status, 'LIVE'); assert.equal(p.pending, 'PENDING_APPROVAL'); assert.equal(p.data.interestingFact, undefined);
  assert.equal((await fetch(`${BASE}/api/squad/public`).then(x => x.json())).players.find(x => x.id === minor).interestingFact, 'Version two fact.', 'the website keeps version 2 until approved');
  assert.equal((await rev({ action: 'discard', id: minor })).status, 200);
  const d = (await rev(null, `?id=${minor}`)).data.profile;
  assert.equal(d.pending, null); assert.equal(d.data.interestingFact, 'Version two fact.', 'back to the live version');
});

test('Super Admin edit: club-only fields, duplicate shirt number warning, hide from the website', async () => {
  const r = await rev({ action: 'edit', id: adult, changes: { debutDate: '2025-08-17', bioHeadline: 'Composed defender', bio: '## Early years\nBorn in Makurdi.\n\nJoined in 2023.', shirtShopUrl: 'https://shop.example.com/okon', shirtNumber: 17 } });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.deepEqual(r.data.errors, {});
  assert.match(r.data.warnings[0], /Shirt number 17 is also given to Tunde/);
  await rev({ action: 'edit', id: adult, changes: { shirtNumber: 5 } });
  assert.equal((await rev({ action: 'edit', id: adult, changes: { shirtShopUrl: 'http://not-secure.example' } })).data.errors.shirtShopUrl.includes('https'), true);
  // A Super Admin's edit of a live profile waits for approval too: approved here.
  assert.equal((await rev({ action: 'approve', id: adult })).status, 200);
  await rev({ action: 'edit', id: oldId, changes: { hideFromWebsite: true } });
  assert.ok((await fetch(`${BASE}/api/squad/public`).then(x => x.json())).players.some(x => x.id === oldId), 'still shown until the change is approved');
  assert.equal((await rev({ action: 'approve', id: oldId })).status, 200);
  const pub = await fetch(`${BASE}/api/squad/public`).then(x => x.json());
  assert.ok(!pub.players.some(x => x.id === oldId), 'hidden from the website');
  const pp = (await rev(null, `?id=${oldId}`)).data.profile;
  assert.equal((await fetch(`${BASE}/api/squad/photo/${oldId}/profile/w400.webp`)).status, 404);
  assert.equal(pp.status, 'LIVE', 'still live, only hidden');
});

test('international career and national team: hidden until a Super Admin has checked the evidence; a change makes it unchecked again', async () => {
  const pub = () => fetch(`${BASE}/api/squad/public`).then(x => x.json()).then(d => d.players.find(x => x.id === adult));
  let a = await pub();
  assert.deepEqual(a.internationalCareer, [], 'not shown before the check'); assert.equal(a.nationalTeam, null);
  const doc = await fetch(`${BASE}/api/partner/squad`, { headers: { Authorization: `Bearer ${KEY}` } }).then(x => x.json());
  assert.deepEqual(doc.players.find(x => x.id === adult).internationalCareer, [], 'nor in the partner feed');
  // Evidence: a PDF or photo, private.
  const draft = (await P('profiles', 'POST', { type: 'player' })).data.id;
  const f = new FormData(); f.append('file', new Blob(['%PDF-1.4 test evidence'], { type: 'application/pdf' }), 'call-up.pdf');
  const up = await P(`profiles/${draft}/evidence`, 'POST', f);
  assert.equal(up.status, 200, JSON.stringify(up.data)); assert.equal(up.data.evidence.type, 'application/pdf');
  const bad = new FormData(); bad.append('file', new Blob(['hello'], { type: 'text/plain' }), 'x.txt');
  assert.equal((await P(`profiles/${draft}/evidence`, 'POST', bad)).status, 400, 'only photos and PDFs');
  assert.equal((await fetch(`${BASE}/api/squad-portal/file/${draft}/evidence/file`)).status, 401, 'private');
  assert.equal((await fetch(`${BASE}/api/squad-portal/file/${draft}/evidence/file`, { headers: ADMIN })).status, 200, 'the club reviewers can open it');
  await P(`profiles/${draft}`, 'DELETE');
  // The Super Admin ticks "checked": shown.
  assert.deepEqual((await rev({ action: 'edit', id: adult, changes: { intlVerified: true } })).data.errors, {});
  await rev({ action: 'approve', id: adult });
  a = await pub();
  assert.equal(a.internationalCareer[0].level, 'U20'); assert.equal(a.nationalTeam, 'NG');
  // The player changes it in the portal: unchecked again until checked; shown on the website only after approval.
  const ch = await P(`profiles/${adult}`, 'PATCH', { changes: { internationalCareer: [{ level: 'U23', caps: 9, goals: 0, tournaments: '' }] }, commit: true });
  assert.equal(ch.data.saved.intlVerified, false);
  assert.equal((await pub()).internationalCareer[0].level, 'U20', 'the live version stays until the change is approved');
  assert.equal((await P(`profiles/${adult}/submit`, 'POST')).status, 200);
  assert.equal((await rev({ action: 'request_changes', id: adult, note: 'Please add the tournament too.' })).status, 200);
  assert.equal((await P(`profiles/${adult}/submit`, 'POST')).status, 200);
  await rev({ action: 'approve', id: adult });
  assert.deepEqual((await pub()).internationalCareer, [], 'hidden again after the change');
  await rev({ action: 'edit', id: adult, changes: { intlVerified: true, internationalCareer: [{ level: 'U20', caps: 4, goals: 1, tournaments: 'U-20 AFCON 2017' }] } });
  await rev({ action: 'approve', id: adult });
  assert.equal((await pub()).internationalCareer[0].level, 'U20', 'a Super Admin edit keeps it checked');
});

test('the portal form no longer shows Public / Media / Private labels', () => {
  const src = readFileSync(new URL('../src/scripts/squadPortal/form.ts', import.meta.url), 'utf8');
  assert.match(src, /function chip\(_use\?: string, _f\?: any\) \{ return ''; \}/);
  assert.ok(!src.includes('sp-key'), 'no colour key box');
});

test('website feed: "First Surname"; middle name never; full date of birth only from 18; never private; coaches have no number', async () => {
  const pub = await fetch(`${BASE}/api/squad/public`).then(x => x.json());
  const a = pub.players.find(x => x.id === adult), m = pub.players.find(x => x.id === minor), c = pub.staff.find(x => x.id === coach);
  assert.equal(a.slug, `chidi-${SUR.toLowerCase()}`); assert.equal(a.name, `Chidi ${SUR}`); assert.equal(a.officialName, `${SUR.toUpperCase()}, Chidi`, 'no middle name'); assert.equal(a.shortName, SUR);
  assert.equal(a.dob, '1998-03-14'); assert.equal(a.debutDate, '2025-08-17'); assert.equal(a.nationality, 'NG'); assert.equal(a.nationality2, 'GB'); assert.equal(a.group, 'DEF');
  assert.equal(m.dob, null); assert.equal(m.officialName, `${KID.toUpperCase()}, Tunde`, 'no middle name for an under-18');
  assert.equal(c.number, undefined); assert.equal(c.role, 'Head Coach'); assert.equal(c.licence, 'CAF A Licence');
  const text = JSON.stringify(pub);
  for (const secret of ['+2348035551111', 'Mama Test', 'Guardian', '2011-01-20', 'Secret', 'Emeka', 'Hidden', 'middleName']) assert.ok(!text.includes(secret), `not public: ${secret}`);
});

test(`partner feed: schemaVersion ${SCHEMA_VERSION}: first name and surname, no middle name, pronunciation null`, async () => {
  const doc = await fetch(`${BASE}/api/partner/squad`, { headers: { Authorization: `Bearer ${KEY}` } }).then(x => x.json());
  assert.equal(doc.schemaVersion, '1.2'); assert.deepEqual(validatePackage(doc), []);
  const a = doc.players.find(x => x.id === adult);
  assert.equal(a.firstName, 'Chidi'); assert.equal(a.surname, SUR); assert.equal(a.displayName, `Chidi ${SUR}`); assert.equal(a.officialName, `${SUR.toUpperCase()}, Chidi`); assert.equal(a.nationality.name, 'Nigeria'); assert.equal(a.previousClubs[0].country.code, 'NG');
  assert.equal(a.pronunciation, null); assert.equal(a.pronunciationAudio, null);
  assert.ok(!JSON.stringify(doc).includes('Emeka') && !JSON.stringify(doc).includes('Hidden'), 'no middle names in the partner API');
  assert.equal(doc.players.find(x => x.id === minor).dateOfBirth, '');
});

test('season stats endpoint answers for any player (zeros before matches)', async () => {
  const r = await fetch(`${BASE}/api/squad/stats?player=chidi-${SUR.toLowerCase()}`).then(x => x.json());
  for (const k of ['apps', 'starts', 'goals', 'assists', 'cleanSheets', 'minutes', 'yellow', 'red']) assert.equal(typeof r.stats[k], 'number', k);
});

test('exports (Super Admins): no middle name, no pronunciation', async () => {
  const ex = await fetch(`${BASE}/api/admin/squad-profiles?export=1&which=verified&season=current`, { headers: ADMIN }).then(r => r.json());
  const a = ex.profiles.find(x => x.id === adult);
  assert.ok(a); assert.ok(!('middleName' in a.data) && !('pronunciation' in a.data) && !('displayName' in a.data));
  assert.ok(!JSON.stringify(ex).includes('Emeka'));
});

test('a corrected name moves the web address; the old one is kept for a 301 redirect', async () => {
  await fetch(`${BASE}/api/squad/public`); // the address the website has now
  const e = await rev({ action: 'edit', id: adult, changes: { firstName: 'Chidiebere' } });
  assert.deepEqual(e.data.errors, {});
  assert.equal((await fetch(`${BASE}/api/squad/public`).then(x => x.json())).players.find(x => x.id === adult).slug, `chidi-${SUR.toLowerCase()}`, 'the address moves only when approved');
  await rev({ action: 'approve', id: adult });
  const pub = await fetch(`${BASE}/api/squad/public`).then(x => x.json());
  const a = pub.players.find(x => x.id === adult);
  assert.equal(a.slug, `chidiebere-${SUR.toLowerCase()}`); assert.deepEqual(a.oldSlugs, [`chidi-${SUR.toLowerCase()}`]);
  assert.ok(pub.redirects.some(r => r.from === `/squad/chidi-${SUR.toLowerCase()}/` && r.to === `/squad/chidiebere-${SUR.toLowerCase()}/`));
  await rev({ action: 'edit', id: adult, changes: { firstName: 'Chidi' } });
  await rev({ action: 'approve', id: adult });
  const back = (await fetch(`${BASE}/api/squad/public`).then(x => x.json())).players.find(x => x.id === adult);
  assert.equal(back.slug, `chidi-${SUR.toLowerCase()}`); assert.deepEqual(back.oldSlugs, [`chidiebere-${SUR.toLowerCase()}`], 'changing back: the current address is never also an old one');
});

test('"Draft bio with Claude": public facts only, a preview that is never saved by itself', async () => {
  const before = (await rev(null, `?id=${adult}`)).data.profile.data.bio;
  claudeAsked = [];
  const r = await rev({ action: 'draft_bio', id: adult, extra: 'Call him on 08035559999 or a@b.com. He joined from Kwara United.' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.proposal.headline, 'Composed defender'); assert.match(r.data.proposal.missing, /joined/);
  const sent = claudeAsked.join('');
  for (const secret of ['08035551111', '+2348035551111', 'Mama Test', '08035559999', 'a@b.com', '1998-03-14']) assert.ok(!sent.includes(secret), `never sent to Claude: ${secret}`);
  assert.ok(sent.includes('Kwara United') && sent.includes('Makurdi'));
  assert.ok(sent.includes('NEVER invent'));
  assert.equal((await rev(null, `?id=${adult}`)).data.profile.data.bio, before, 'not saved');
});

test('built pages: squad list sections, player and coach profiles (no number for the coach), nothing private', () => {
  execSync('npm run build', { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'pipe', env: { ...process.env, SQUAD_SOURCE_URL: BASE } });
  const dist = new URL('../dist/', import.meta.url);
  const list = readFileSync(new URL('squad/index.html', dist), 'utf8');
  assert.match(list, /First Team <span class="r"[^>]*>Squad<\/span>/);
  for (const h of ['Goalkeepers', 'Defenders', 'Forwards', 'Coaching Staff']) assert.ok(list.includes(h) || h === 'Goalkeepers', h);
  assert.ok(list.indexOf('id="g-DEF"') < list.indexOf('id="g-FWD"'));
  const pl = readFileSync(new URL(`squad/chidi-${SUR.toLowerCase()}/index.html`, dist), 'utf8');
  assert.match(pl, new RegExp(`<title>Chidi ${SUR} \\| Lobi Stars FC</title>`));
  assert.match(pl, new RegExp(`${SUR.toUpperCase()}, Chidi<`)); assert.ok(!pl.includes('Emeka'), 'middle name never on the page'); assert.match(pl, /14 March, 1998/); assert.match(pl, /1\.86m \(6ft 1in\)/); assert.match(pl, /17 August, 2025/);
  assert.match(pl, /Buy [A-Za-z]+'s shirt/); assert.match(pl, /alt="Nigeria flag"/); assert.match(pl, /An interesting fact/); assert.match(pl, /Before Lobi Stars/); assert.match(pl, /International career/);
  assert.match(pl, /"@type":"Person"/); assert.match(pl, /"memberOf":\{"@type":"SportsTeam","name":"Lobi Stars FC"/);
  for (const secret of ['+2348035551111', 'Mama Test']) assert.ok(!pl.includes(secret));
  const kid = readFileSync(new URL(`squad/tunde-${KID.toLowerCase()}/index.html`, dist), 'utf8');
  assert.ok(!kid.includes('2011') && !kid.includes('Secret'), 'no date of birth or middle name for an under-18');
  assert.match(kid, /Yet to debut/);
  const co = readFileSync(new URL(`squad/staff/terver-${COACH.toLowerCase()}/index.html`, dist), 'utf8');
  assert.ok(!co.includes('class="pf-num"'), 'no shirt number for a coach'); assert.match(co, /An interesting fact about the coach/); assert.match(co, /Kano Pillars/); assert.ok(!co.includes('Hidden'));
  const st = readFileSync(new URL(`squad/staff/ada-kit${T}/index.html`, dist), 'utf8');
  assert.match(st, /An interesting fact about the staff member/, 'club staff wording');
  assert.match(readFileSync(new URL('_redirects', dist), 'utf8'), new RegExp(`/squad/chidiebere-${SUR.toLowerCase()}/ /squad/chidi-${SUR.toLowerCase()}/ 301`), 'old address redirects');
  assert.ok(!existsSync(new URL('squad/musa-bello/index.html', dist)), 'hidden profile has no page');
  assert.match(readFileSync(new URL('sitemap.xml', dist), 'utf8'), new RegExp(`/squad/chidi-${SUR.toLowerCase()}/`));
});
