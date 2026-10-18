// QR advert campaigns: /p/<code> short links (always a 302, never a dead end,
// link previews not counted), the scan page funnel (landing, sign-in started /
// completed, download, read), the one-tap email link (only on tap, dies with
// the code), campaign admin (no code changes, no deletes, reserved words),
// funnel stats with no personal data. Needs the local Pages dev server with
// --r2=PROGRAMME_BUCKET, FANS_DEV_LINKS=1 and ADMIN_CODE=test-code-123.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseDevice, isBotOrPreview, validSrc, randomCode } from '../functions/api/_lib/qr.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const IG = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0';
const api = (path, method = 'GET', body, headers = ADMIN) => fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' })
  .then(async r => ({ status: r.status, headers: r.headers, data: await r.clone().json().catch(() => ({})) }));
const made = [];
after(async () => { for (const id of made) await fetch(`${BASE}/api/admin/programmes/${id}`, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ status: 'hidden' }) }); });

const JPG = (n = 120) => new Blob([new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, ...new Array(n).fill(7)])], { type: 'image/jpeg' });
async function liveProgramme() {
  const r = await api('/api/admin/programmes', 'POST', { title: `Lobi Stars vs QR ${uid()}`, kickoffAt: new Date(Date.now() + 864e5).toISOString() });
  made.push(r.data.id);
  const f = new FormData();
  f.append('pdf', new Blob([new TextEncoder().encode('%PDF-1.7\n% qr test\n')]), 'p.pdf'); f.append('cover', JPG(), 'c.jpg'); f.append('pageCount', '4');
  for (let i = 1; i <= 4; i++) f.append(`page${i}`, JPG(), `p${i}.jpg`);
  assert.equal((await fetch(`${BASE}/api/admin/programmes/${r.data.id}/upload`, { method: 'POST', headers: { 'x-admin-code': ADMIN['x-admin-code'] }, body: f })).status, 200);
  assert.equal((await api(`/api/admin/programmes/${r.data.id}`, 'PATCH', { status: 'published' })).status, 200);
  return r.data;
}
async function newCampaign(over = {}) {
  const r = await api('/api/admin/qr/campaigns', 'POST', { label: `Test ${uid()}`, channel: 'flyer', ...over });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.campaign;
}
const stats = async id => (await api(`/api/admin/qr/stats?campaign=${id}`)).data;

test('helpers: device, in-app browsers, link previews, src rule, random codes', () => {
  assert.deepEqual(parseDevice(ANDROID), { device: 'android', inApp: false });
  assert.deepEqual(parseDevice(IG), { device: 'ios', inApp: true });
  assert.equal(parseDevice('Mozilla/5.0 (Windows NT 10.0) Chrome/120').device, 'desktop');
  for (const ua of ['WhatsApp/2.23.20.0', 'facebookexternalhit/1.1', 'Twitterbot/1.0', 'TelegramBot (like TwitterBot)', 'curl/8.0', 'python-requests/2.31', 'Mozilla/5.0 HeadlessChrome/120']) assert.equal(isBotOrPreview(ua), true, ua);
  assert.equal(isBotOrPreview(ANDROID), false);
  assert.equal(isBotOrPreview(ANDROID, 'HEAD'), true);
  assert.equal(validSrc('gate'), 'gate'); assert.equal(validSrc('Gate'), null); assert.equal(validSrc('x'.repeat(21)), null);
  for (let i = 0; i < 50; i++) assert.match(randomCode(), /^[abcdefghjkmnpqrstuvwxyz23456789]{5}$/);
});

test('/p/<code>: 302 to the scan page, counts real scans only, never a dead end', async () => {
  await api('/api/admin/qr/campaigns'); // seeds gate, screen, social, status, radio, flyer, kiosk
  const c = await newCampaign();
  const before = (await stats(c.id)).funnel.scan;
  const r = await fetch(`${BASE}/p/${c.code}`, { redirect: 'manual', headers: { 'User-Agent': ANDROID } });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), `${BASE}/programme/scan/?c=${c.code}`);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  await fetch(`${BASE}/p/${c.code.toUpperCase()}`, { redirect: 'manual', headers: { 'User-Agent': IG } });
  await fetch(`${BASE}/p/${c.code}`, { redirect: 'manual', headers: { 'User-Agent': 'WhatsApp/2.23.20.0' } });
  await fetch(`${BASE}/p/${c.code}`, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': ANDROID } });
  await new Promise(res => setTimeout(res, 800));
  const s = await stats(c.id);
  assert.equal(s.funnel.scan - before, 2, 'Android + Instagram counted; WhatsApp preview and HEAD not');
  assert.equal(s.devices.android, 1); assert.equal(s.devices.ios, 1);
  assert.equal(s.inAppShare, 0.5);
  for (const path of ['/p/nope-unknown', '/p', '/p/']) {
    const x = await fetch(BASE + path, { redirect: 'manual' });
    assert.equal(x.status, 302, path);
    assert.equal(x.headers.get('location'), `${BASE}/programme/scan/`, path);
  }
  // Switched off: still works.
  await api(`/api/admin/qr/campaigns/${c.id}`, 'PATCH', { is_active: false });
  assert.equal((await fetch(`${BASE}/p/${c.code}`, { redirect: 'manual', headers: { 'User-Agent': ANDROID } })).headers.get('location'), `${BASE}/programme/scan/?c=${c.code}`);
});

test('scan funnel: landing, code sign-in, download and read are counted for the campaign; new fan credited', async () => {
  const prog = await liveProgramme();
  const cur = (await api('/api/programme/current')).data;
  assert.ok(cur.programme.pdfSizeBytes > 0, 'size for the button');
  const c = await newCampaign({ channel: 'poster' });
  const H = { 'Content-Type': 'application/json', Origin: BASE, 'CF-Connecting-IP': randIp(), 'User-Agent': ANDROID };
  assert.equal((await api('/api/qr/event', 'POST', { src: c.code, type: 'landing' }, H)).status, 204);
  assert.equal((await api('/api/qr/event', 'POST', { src: c.code, type: 'download' }, H)).status, 204, 'only landing from the page');
  await api('/api/qr/event', 'POST', { src: c.code, type: 'landing' }, { ...H, Origin: 'https://evil.example' });
  const email = `qr-${uid()}@example.com`;
  const req = await api('/api/fan/auth/request', 'POST', { email, src: c.code, intent: 'download' }, H);
  assert.equal(req.status, 200);
  assert.match(req.data.devLink, new RegExp(`/programme/confirm/\\?e=${encodeURIComponent(email).replace(/\./g, '\\.')}&t=[A-Za-z0-9_-]{43}&src=${c.code}&intent=download$`));
  const v = await api('/api/fan/auth/verify', 'POST', { email, code: req.data.devCode, src: c.code }, H);
  assert.equal(v.status, 200);
  const cookie = v.headers.getSetCookie().map(x => x.split(';')[0]).join('; ');
  await api('/api/fan/auth/profile', 'POST', { firstName: 'Scan' }, { ...H, Cookie: cookie });
  // Plain navigation download (as the scan page does).
  const dl = await fetch(`${BASE}/api/programme/${prog.slug}/download?src=${c.code}`, { headers: { Cookie: cookie, Accept: 'text/html', 'User-Agent': ANDROID } });
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-type'), 'application/pdf');
  await api(`/api/programme/${prog.slug}/event`, 'POST', { type: 'open', src: c.code }, { ...H, Cookie: cookie });
  // Not signed in, opened as a page: back to the scan page, not raw JSON.
  const anon = await fetch(`${BASE}/api/programme/${prog.slug}/download?src=${c.code}`, { redirect: 'manual', headers: { Accept: 'text/html' } });
  assert.equal(anon.status, 302);
  assert.equal(anon.headers.get('location'), `${BASE}/programme/scan/?c=${c.code}&e=signin`);
  await new Promise(res => setTimeout(res, 800));
  const s = await stats(c.id);
  assert.deepEqual([s.funnel.landing, s.funnel.signin_started, s.funnel.signin_completed, s.funnel.download, s.funnel.read], [1, 1, 1, 1, 1]);
  assert.equal(s.newFans, 1, 'members.first_src');
  const list = (await api('/api/admin/qr/campaigns')).data.campaigns.find(x => x.id === c.id);
  assert.equal(list.counts.download, 1);
  assert.equal(list.newFans, 1);
  assert.ok(!JSON.stringify(s).includes(email), 'no personal data in stats');
});

test('one-tap email link: only works once, dies with the code, wrong tokens count as tries', async () => {
  const c = await newCampaign();
  const H = { 'Content-Type': 'application/json', Origin: BASE, 'CF-Connecting-IP': randIp() };
  const email = `link-${uid()}@example.com`;
  const req = await api('/api/fan/auth/request', 'POST', { email, src: c.code, intent: 'read' }, H);
  const token = new URL(req.data.devLink).searchParams.get('t');
  assert.equal((await api('/api/fan/auth/verify-link', 'POST', { email, token: 'x'.repeat(43) }, H)).status, 400);
  const ok = await api('/api/fan/auth/verify-link', 'POST', { email, token, src: c.code, intent: 'read' }, H);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.intent, 'read');
  assert.equal(ok.data.needsProfile, true);
  assert.match(ok.headers.getSetCookie().join(';'), /ls_session=/);
  assert.equal((await api('/api/fan/auth/verify-link', 'POST', { email, token }, H)).status, 400, 'used once');
  assert.equal((await api('/api/fan/auth/verify', 'POST', { email, code: req.data.devCode }, H)).status, 400, 'the code died with the link');
  // The confirm page itself signs nobody in (scanners open links).
  const page = await fetch(`${BASE}/programme/confirm/?e=${encodeURIComponent(email)}&t=${token}`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.getSetCookie().length, 0);
  // Five wrong tokens kill the code.
  const e2 = `link2-${uid()}@example.com`;
  const r2 = await api('/api/fan/auth/request', 'POST', { email: e2 }, { ...H, 'CF-Connecting-IP': randIp() });
  for (let i = 0; i < 5; i++) await api('/api/fan/auth/verify-link', 'POST', { email: e2, token: 'y'.repeat(43) }, H);
  assert.equal((await api('/api/fan/auth/verify-link', 'POST', { email: e2, token: new URL(r2.data.devLink).searchParams.get('t') }, H)).status, 400);
});

test('campaign admin: validation, reserved words, codes never change, no delete, roles', async () => {
  assert.equal((await api('/api/admin/qr/campaigns', 'POST', { label: '', channel: 'poster' })).status, 400);
  assert.equal((await api('/api/admin/qr/campaigns', 'POST', { label: 'X', channel: 'tv' })).status, 400);
  for (const code of ['ab', 'bad_code', 'with space', 'way-too-long-code']) assert.equal((await api('/api/admin/qr/campaigns', 'POST', { label: 'X', channel: 'poster', code })).status, 400, code);
  for (const code of ['admin', 'scan', 'programme']) assert.equal((await api('/api/admin/qr/campaigns', 'POST', { label: 'X', channel: 'poster', code })).status, 400, code);
  assert.equal((await api('/api/admin/qr/campaigns', 'POST', { label: 'X', channel: 'poster', code: 'gate' })).status, 409);
  const c = await newCampaign({ code: `t${uid().slice(0, 5)}` });
  assert.equal((await api(`/api/admin/qr/campaigns/${c.id}`, 'PATCH', { code: 'other' })).status, 400, 'code can never change');
  const ed = await api(`/api/admin/qr/campaigns/${c.id}`, 'PATCH', { label: 'Renamed', channel: 'sponsor', notes: '<b>x</b>' });
  assert.equal(ed.data.campaign.label, 'Renamed');
  assert.equal(ed.data.campaign.code, c.code);
  assert.equal(ed.data.campaign.notes, 'x');
  assert.equal((await api(`/api/admin/qr/campaigns/${c.id}`, 'DELETE')).status, 405, 'no delete');
  const auto = await newCampaign();
  assert.match(auto.code, /^[a-z2-9]{5}$/);
  const login = async role => {
    const email = `qr-${role}-${uid()}@example.com`;
    await api('/api/admin/staff', 'POST', { name: `QR ${role}`, email, password: 'Role-Test-2026!', role });
    const l = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
    return { Cookie: l.headers.get('set-cookie').split(';')[0] };
  };
  assert.equal((await api('/api/admin/qr/campaigns', 'GET', null, await login('commercial_manager'))).status, 200, 'partner reports and QR campaigns');
  assert.equal((await api('/api/admin/qr/campaigns', 'GET', null, await login('matchday'))).status, 403);
  assert.equal((await api('/api/admin/qr/stats', 'GET', null, await login('fan_support'))).status, 403);
});

test('scan and confirm pages are small and stand-alone; privacy mentions scan counts', async () => {
  const scan = await fetch(`${BASE}/programme/scan/?c=gate`).then(r => r.text());
  assert.ok(scan.length < 60000, `scan page ${scan.length} bytes`);
  assert.match(scan, /Download PDF/);
  assert.match(scan, /open this page in Chrome or Safari/);
  assert.ok(!/<script[^>]+src=/.test(scan), 'no external scripts until needed');
  const confirm = await fetch(`${BASE}/programme/confirm/`).then(r => r.text());
  assert.match(confirm, /Tap to continue/);
  assert.match(await fetch(`${BASE}/privacy/`).then(r => r.text()), /QR codes:/);
});
