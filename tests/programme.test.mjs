// Digital Match Day Programme: staff create, upload (4 pages, checked on the
// server) and publish or schedule; fans sign in with an emailed code (their
// normal fan account), read the pages, download the PDF; clicks and pages are
// counted; roles. Needs the local Pages dev server started with
// --r2=PROGRAMME_BUCKET, FANS_DEV_LINKS=1 (codes returned for tests) and ADMIN_CODE=test-code-123.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateCode, timingSafeEqual, normaliseEmail } from '../functions/api/_lib/fanCode.js';
import { slugify, friendlyPdfName, isLive, cleanLinkUrl } from '../functions/api/_lib/programme.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const api = (path, method = 'GET', body, headers = ADMIN) => fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' })
  .then(async r => ({ status: r.status, headers: r.headers, data: await r.clone().json().catch(() => ({})), r }));
const made = [], staff = [];
after(async () => {
  for (const id of made) await fetch(`${BASE}/api/admin/programmes/${id}`, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ status: 'hidden' }) });
  for (const id of staff) await fetch(`${BASE}/api/admin/staff/${id}`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ active: false }) });
});

const PDF = () => new Blob([new TextEncoder().encode('%PDF-1.7\n% test programme\n')], { type: 'application/pdf' });
const JPG = (n = 200) => new Blob([new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, ...new Array(n).fill(7)])], { type: 'image/jpeg' });
function uploadForm({ pages = 4, pageCount = 4, pdf = PDF(), cover = JPG() } = {}) {
  const f = new FormData();
  f.append('pdf', pdf, 'p.pdf'); f.append('cover', cover, 'c.jpg'); f.append('pageCount', String(pageCount));
  for (let i = 1; i <= pages; i++) { f.append(`page${i}`, JPG(100 + i), `p${i}.jpg`); f.append(`width${i}`, '1240'); f.append(`height${i}`, '1754'); }
  return f;
}
const upload = (id, opts) => fetch(`${BASE}/api/admin/programmes/${id}/upload`, { method: 'POST', headers: { 'x-admin-code': ADMIN['x-admin-code'] }, body: uploadForm(opts) })
  .then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));

async function newProgramme(over = {}) {
  const r = await api('/api/admin/programmes', 'POST', { title: `Lobi Stars vs Test ${uid()}`, opponent: 'Test FC', competition: 'NNL', venue: 'McCarthy Stadium', kickoffAt: new Date(Date.now() + 2 * 864e5).toISOString(), ...over });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  made.push(r.data.id);
  return r.data;
}

/** A fan session via the email code. Returns { cookie, needsProfile }. */
async function signIn(email, next = '/programme/') {
  const ip = randIp();
  const H = { 'Content-Type': 'application/json', Origin: BASE, 'CF-Connecting-IP': ip };
  const req = await api('/api/fan/auth/request', 'POST', { email, next }, H);
  assert.equal(req.status, 200, JSON.stringify(req.data));
  assert.match(req.data.devCode, /^\d{6}$/);
  const v = await api('/api/fan/auth/verify', 'POST', { email, code: req.data.devCode, next }, H);
  assert.equal(v.status, 200, JSON.stringify(v.data));
  const cookie = v.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  return { cookie, needsProfile: v.data.needsProfile, H };
}

test('helpers: codes, email, slug, file name, live rule, link addresses', () => {
  for (let i = 0; i < 200; i++) assert.match(generateCode(), /^\d{6}$/);
  assert.ok(timingSafeEqual('abc', 'abc') && !timingSafeEqual('abc', 'abd') && !timingSafeEqual('abc', 'abcd'));
  assert.equal(normaliseEmail('  Ada@Example.COM '), 'ada@example.com');
  assert.equal(normaliseEmail('nope'), null);
  assert.equal(slugify('Lobi Stars vs Bichi First', '2026-11-08T15:00:00Z'), 'lobi-stars-vs-bichi-first-2026-11-08');
  assert.equal(friendlyPdfName({ title: 'Lobi Stars vs Bichi First' }), 'Lobi-Stars-vs-Bichi-First-Matchday-Programme.pdf');
  const now = new Date('2026-10-10T12:00:00Z');
  assert.equal(isLive({ status: 'draft', pdf_key: 'x' }, now), false);
  assert.equal(isLive({ status: 'published', pdf_key: null }, now), false);
  assert.equal(isLive({ status: 'scheduled', pdf_key: 'x', publish_at: '2026-10-10T11:00:00Z' }, now), true);
  assert.equal(isLive({ status: 'scheduled', pdf_key: 'x', publish_at: '2026-10-10T13:00:00Z' }, now), false);
  assert.equal(cleanLinkUrl('http://example.com'), null);
  assert.equal(cleanLinkUrl('javascript:alert(1)'), null);
  assert.equal(cleanLinkUrl('/food'), '/food');
  assert.equal(cleanLinkUrl('https://wa.me/2349030399416'), 'https://wa.me/2349030399416');
});

test('upload is checked on the server; publishing needs files; scheduling needs a future time', async () => {
  const { id } = await newProgramme();
  assert.equal((await api(`/api/admin/programmes/${id}`, 'PATCH', { status: 'published' })).status, 409, 'no files yet');
  assert.equal((await upload(id, { pageCount: 3, pages: 3 })).status, 400, 'must be 4 pages');
  assert.equal((await upload(id, { pages: 5 })).status, 400, 'not 5 either');
  assert.equal((await upload(id, { pdf: new Blob(['hello']) })).status, 400, 'not a PDF');
  assert.equal((await upload(id, { cover: new Blob([new Uint8Array([0x89, 0x50, 0x4E, 0x47])]) })).status, 400, 'cover not a JPEG');
  assert.equal((await upload(id, { cover: JPG(600 * 1024) })).status, 413, 'cover over 500 KB');
  const up = await upload(id);
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.equal(up.data.version, 1);
  assert.equal((await api(`/api/admin/programmes/${id}`, 'PATCH', { status: 'scheduled', publishAt: new Date(Date.now() - 6e4).toISOString() })).status, 400, 'past time');
  const pg = await fetch(`${BASE}/api/admin/programmes/${id}/page/2.jpg`, { headers: ADMIN });
  assert.equal(pg.status, 200, 'staff preview of a draft');
  assert.equal(pg.headers.get('content-type'), 'image/jpeg');
  assert.equal((await fetch(`${BASE}/api/admin/programmes/${id}/pdf`, { headers: ADMIN })).headers.get('content-type'), 'application/pdf');
  // Never published: can be deleted.
  assert.equal((await api(`/api/admin/programmes/${id}`, 'DELETE')).status, 200);
  assert.equal((await api(`/api/admin/programmes/${id}`)).status, 404);
});

test('fan sign-in by code: same reply for any email, wrong codes, 5 tries, rate limit, Origin check', async () => {
  const email = `prog-${uid()}@example.com`;
  const ip = randIp();
  const H = { 'Content-Type': 'application/json', Origin: BASE, 'CF-Connecting-IP': ip };
  assert.equal((await api('/api/fan/auth/request', 'POST', { email }, { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip })).status, 403, 'no Origin');
  assert.equal((await api('/api/fan/auth/request', 'POST', { email: 'bad' }, H)).status, 400);
  const r1 = await api('/api/fan/auth/request', 'POST', { email }, H);
  assert.deepEqual(Object.keys(r1.data).filter(k => !['devCode', 'devLink'].includes(k)), ['ok']);
  for (let i = 0; i < 5; i++) {
    const v = await api('/api/fan/auth/verify', 'POST', { email, code: r1.data.devCode === '000000' ? '111111' : '000000' }, H);
    assert.equal(v.status, 400);
    assert.equal(v.data.error, "That code didn't work. Check it or request a new one.");
  }
  assert.equal((await api('/api/fan/auth/verify', 'POST', { email, code: r1.data.devCode }, H)).status, 400, 'code dead after 5 wrong tries');
  await api('/api/fan/auth/request', 'POST', { email }, H);
  await api('/api/fan/auth/request', 'POST', { email }, H);
  assert.equal((await api('/api/fan/auth/request', 'POST', { email }, H)).status, 429, 'max 3 per email per 15 minutes');
  assert.equal((await api('/api/fan/me', 'GET', null, {})).data.signedIn, false);
});

test('new fan: profile step, details copied from the newsletter, one newsletter list, existing account reused', async () => {
  const email = `news-${uid()}@example.com`;
  const nl = await api('/api/newsletter', 'POST', { fullName: 'Ngozi Adeyemi', phone: `0803${String(Math.random()).slice(2, 9)}`, email, confirmEmail: email, consent: true, source: 'test' },
    { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() });
  assert.equal(nl.status, 200);
  const s = await signIn(email);
  assert.equal(s.needsProfile, false, 'name copied from the newsletter sign-up');
  const me = (await api('/api/fan/me', 'GET', null, { Cookie: s.cookie })).data;
  assert.deepEqual([me.signedIn, me.firstName, me.email], [true, 'Ngozi', email]);
  // Same login as the rest of the site (fan account).
  assert.equal((await api('/api/auth/me', 'GET', null, { Cookie: s.cookie })).data.member.email, email);

  const fresh = `new-${uid()}@example.com`;
  const f = await signIn(fresh);
  assert.equal(f.needsProfile, true);
  const H = { ...f.H, Cookie: f.cookie };
  assert.equal((await api('/api/fan/auth/profile', 'POST', { firstName: '', marketingConsent: false }, H)).status, 400);
  assert.equal((await api('/api/fan/auth/profile', 'POST', { firstName: '<b>Emeka</b>', lastName: 'Obi', phone: '12345', marketingConsent: true }, H)).status, 400, 'bad phone');
  const p = await api('/api/fan/auth/profile', 'POST', { firstName: '<b>Emeka</b>', lastName: 'Obi', marketingConsent: true }, H);
  assert.equal(p.status, 200);
  assert.equal(p.data.fan.firstName, 'Emeka', 'HTML stripped');
  const subs = (await api(`/api/admin/fans?source=programme&q=${encodeURIComponent(fresh)}`)).data;
  const row = (subs.rows || subs.fans || []).find(x => x.email === fresh);
  assert.ok(row, 'in the fan database as Match Day Programme');
  assert.ok(row.sources.includes('programme') && row.sources.includes('newsletter'), JSON.stringify(row.sources));
  // Signing in again later: same account, no profile step.
  assert.equal((await signIn(fresh)).needsProfile, false);
});

test('live programme: countdown, reading needs sign-in, pages, download, links, events, stats', async () => {
  const { id, slug } = await newProgramme({ kickoffAt: new Date(Date.now() + 864e5).toISOString() });
  assert.equal((await upload(id)).status, 200);
  assert.equal((await api(`/api/admin/programmes/${id}/links`, 'PUT', { links: [{ label: 'Order food on WhatsApp', url: 'https://wa.me/2349030399416' }, { label: 'Bad', url: 'http://x.com' }] })).status, 400);
  const L = await api(`/api/admin/programmes/${id}/links`, 'PUT', { links: [{ label: 'Order food on WhatsApp', url: 'https://wa.me/2349030399416' }, { label: 'Listen live', url: '/commentary/' }] });
  assert.equal(L.status, 200);
  assert.equal((await api(`/api/programme/${slug}`)).status, 404, 'draft is not public');

  const at = new Date(Date.now() + 3600e3).toISOString();
  assert.equal((await api(`/api/admin/programmes/${id}`, 'PATCH', { status: 'scheduled', publishAt: at })).status, 200);
  const cur = (await api('/api/programme/current')).data;
  assert.equal(cur.enabled, true, 'R2 bucket connected');
  assert.ok(cur.serverTime);
  const later = await api(`/api/programme/${slug}`);
  assert.equal(later.data.state, 'upcoming', 'scheduled for later: only the countdown details');
  assert.ok(!('links' in later.data) && !('version' in later.data), 'no files or links before it drops');

  assert.equal((await api(`/api/admin/programmes/${id}`, 'PATCH', { status: 'published' })).status, 200);
  const d = (await api(`/api/programme/${slug}`)).data;
  assert.equal(d.title.startsWith('Lobi Stars vs Test'), true);
  assert.deepEqual(d.links.map(l => Object.keys(l).sort()), [['id', 'label'], ['id', 'label']], 'no addresses sent to the page');
  assert.equal(d.signedIn, false);
  assert.equal((await fetch(`${BASE}/api/programme/${slug}/cover.jpg`)).status, 200, 'cover is public');
  assert.equal((await api(`/api/programme/${slug}/page/1.jpg?v=1`)).status, 401);
  assert.equal((await api(`/api/programme/${slug}/download`)).status, 401);

  const fresh = `reader-${uid()}@example.com`;
  const s = await signIn(fresh, `/programme/read/?slug=${slug}`);
  const C = { Cookie: s.cookie };
  assert.equal((await api(`/api/programme/${slug}/page/1.jpg`, 'GET', null, C)).data.error, 'profile_required');
  await api('/api/fan/auth/profile', 'POST', { firstName: 'Ada', marketingConsent: false }, { ...s.H, ...C });
  const img = await fetch(`${BASE}/api/programme/${slug}/page/3.jpg?v=1`, { headers: C });
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.match(img.headers.get('cache-control'), /private, max-age=31536000, immutable/);
  assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await api(`/api/programme/${slug}/page/5.jpg`, 'GET', null, C)).status, 404);
  const pdf = await fetch(`${BASE}/api/programme/${slug}/download`, { headers: C });
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-disposition'), /attachment; filename="Lobi-Stars-vs-Test-[a-z0-9]+-Matchday-Programme\.pdf"/);
  assert.equal(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 5)), '%PDF-');

  const ev = (type, extra = {}, h = { ...s.H, ...C }) => api(`/api/programme/${slug}/event`, 'POST', { type, ...extra }, h);
  assert.equal((await ev('landing', { src: 'qr-gate' })).status, 204);
  assert.equal((await ev('open')).status, 204);
  for (const page of [1, 2, 2]) assert.equal((await ev('page_view', { page })).status, 204);
  assert.equal((await ev('download')).status, 400, 'download is only logged by the server');
  assert.equal((await ev('page_view', { page: 9 })).status, 400);
  await ev('open', {}, { 'Content-Type': 'application/json', Origin: 'https://evil.example' });
  const click = await api(`/api/programme/${slug}/link/${L.data.links[0].id}`, 'GET', null, C);
  assert.equal(click.status, 302);
  assert.equal(click.headers.get('location'), 'https://wa.me/2349030399416');
  assert.equal((await api(`/api/programme/${slug}/link/999999?url=https://evil.example`)).headers.get('location'), `${BASE}/programme/`);

  const st = (await api(`/api/admin/programmes/${id}/stats`)).data;
  assert.equal(st.opens, 1, 'the other-site event was ignored');
  assert.equal(st.downloads, 1);
  assert.deepEqual(st.pageViews, [1, 2, 0, 0]);
  assert.equal(st.uniqueReaders, 1);
  assert.equal(st.links[0].clicks, 1);
  assert.deepEqual(st.sources, [{ src: 'qr-gate', n: 1 }]);
  assert.equal(st.newFans, 1, 'new fan credited to this programme');

  // Re-upload: new version, new image addresses; published programmes can't be deleted.
  const up2 = await upload(id);
  assert.equal(up2.data.version, 2);
  assert.equal((await api(`/api/programme/${slug}`)).data.version, 2);
  assert.equal((await api(`/api/admin/programmes/${id}`, 'DELETE')).status, 409);
  assert.equal((await api(`/api/admin/programmes/${id}`, 'PATCH', { status: 'hidden' })).status, 200);
  assert.equal((await api(`/api/programme/${slug}`)).status, 404, 'hidden');

  // Sign out.
  const out = await api('/api/fan/auth/logout', 'POST', {}, { ...s.H, ...C });
  assert.match(out.headers.getSetCookie().join(';'), /ls_session=;/);
});

test('roles: Matchday and Media staff manage programmes; others cannot; delete request reaches the Inbox', async () => {
  const login = async role => {
    const email = `pg-${role}-${uid()}@example.com`;
    const r = await api('/api/admin/staff', 'POST', { name: `PG ${role}`, email, password: 'Role-Test-2026!', role });
    staff.push(r.data.id);
    const l = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
    return { Cookie: l.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' };
  };
  for (const role of ['matchday', 'media']) assert.equal((await api('/api/admin/programmes', 'GET', null, await login(role))).status, 200, role);
  for (const role of ['fan_support', 'commercial', 'kitchen']) assert.equal((await api('/api/admin/programmes', 'GET', null, await login(role))).status, 403, role);
  const tag = uid();
  const email = `delete-${tag}@example.com`;
  assert.equal((await api('/api/fan/delete-request', 'POST', { email }, { 'Content-Type': 'application/json', Origin: BASE, 'CF-Connecting-IP': randIp() })).status, 200);
  const inbox = (await api(`/api/admin/inbox?q=${email}`)).data;
  assert.ok(JSON.stringify(inbox).includes('Data deletion request'), 'in the Inbox');
});

test('service worker caches programme pages for offline reading, never the PDF', async () => {
  const sw = await fetch(`${BASE}/sw.js`).then(r => r.text());
  assert.match(sw, /programme-pages-v1/);
  assert.match(sw, /clear-programme-pages/);
});
