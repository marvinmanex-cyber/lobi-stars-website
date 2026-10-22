// Squad & Staff Data Portal, Phase 1: the private link (not linked anywhere,
// never indexed), its own login (lock, human check, name required), the portal
// login blocked from every admin page and API, CSRF, the Super Admin settings
// (new password signs everyone out, portal on/off), Super Admins only.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123 and a fresh build in dist/.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 8);
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const adminCall = (body) => fetch(`${BASE}/api/admin/squad-portal`, { method: body ? 'POST' : 'GET', headers: ADMIN, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const login = (b) => fetch(`${BASE}/api/squad-portal/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify(b) })
  .then(async r => ({ status: r.status, data: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').match(/ls_squad=[^;]+/)?.[0] || null }));
let password = '', username = '';
after(async () => { await adminCall({ action: 'enabled', enabled: true }); });

test('the portal page: private, never indexed, strict headers; other /staff/ addresses are not found', async () => {
  const r = await fetch(`${BASE}/staff/squad-data/`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
  assert.match(html, /SQUAD &amp; STAFF DATA PORTAL/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.match(r.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  assert.match(r.headers.get('permissions-policy') || '', /microphone=\(self\)/);
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.equal((await fetch(`${BASE}/staff/squad-data`, { redirect: 'manual' })).status, 301);
  assert.equal((await fetch(`${BASE}/staff/anything-else/`)).status, 404);
  assert.match(await (await fetch(`${BASE}/robots.txt`)).text(), /Disallow: \/staff\//);
});

test('the portal link appears on no public page, menu, sitemap or search index', () => {
  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  const hits = [];
  const walk = d => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) { if (!/[\\/]staff$|[\\/]admin$/.test(p)) walk(p); } else if (/\.(html|xml|json|txt|js)$/.test(f) && !/robots\.txt$/.test(f)) { if (readFileSync(p, 'utf8').includes('/staff/squad-data')) hits.push(p); } } };
  walk(dist);
  assert.deepEqual(hits, []);
});

test('Super Admin settings: link, username, password shown once; others are refused', async () => {
  const v = await adminCall();
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.match(v.data.link, /\/staff\/squad-data$/);
  username = `squad-${uid()}`;
  assert.equal((await adminCall({ action: 'username', username: 'x' })).status, 400);
  assert.equal((await adminCall({ action: 'username', username })).status, 200);
  const p = await adminCall({ action: 'new_password' });
  assert.match(p.data.password, /^[\w]{5}-[\w]{5}-[\w]{5}-[\w]{5}$/);
  password = p.data.password;
  assert.equal(p.data.hasPassword, true);
  assert.equal((await adminCall({ action: 'season', season: '2026-27' })).status, 400);
  assert.equal((await adminCall({ action: 'season', season: '2026/27' })).status, 200);
  // Website & Data Officer (not a Super Admin): refused.
  const email = `spp-${uid()}@example.com`;
  const made = await fetch(`${BASE}/api/admin/staff`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ name: 'Data Officer', email, password: 'Role-Test-2026!', role: 'matchday_admin' }) }).then(r => r.json());
  const l = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
  const h = { Cookie: l.headers.get('set-cookie').split(';')[0] };
  assert.equal((await fetch(`${BASE}/api/admin/squad-portal`, { headers: h })).status, 403);
  await fetch(`${BASE}/api/admin/staff/${made.id}`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ active: false, reason: 'test finished' }) });
});

test('sign in: name required; the portal cookie opens the portal API but no admin page or API; CSRF', async () => {
  assert.equal((await login({ username, password, name: '' })).status, 400, 'your name is required');
  const ok = await login({ username: username.toUpperCase(), password, name: 'Grace Test' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.ok(ok.cookie, 'portal cookie set');
  const H = { Cookie: ok.cookie };
  const me = await fetch(`${BASE}/api/squad-portal/session`, { headers: H }).then(r => r.json());
  assert.equal(me.name, 'Grace Test');
  assert.equal(me.season, '2026/27');
  for (const p of ['/api/admin/notifications', '/api/admin/staff', '/api/admin/food-orders', '/api/admin/squad-portal', '/api/admin/health']) assert.equal((await fetch(BASE + p, { headers: H })).status, 403, p);
  for (const p of ['/admin/', '/admin/squad-portal/', '/admin/food-orders/live/']) assert.equal((await fetch(BASE + p, { headers: H, redirect: 'manual' })).status, 403, p);
  assert.equal((await fetch(`${BASE}/admin/login/`, { headers: H, redirect: 'manual' })).status, 200, 'the admin login page still opens');
  assert.equal((await fetch(`${BASE}/api/squad-portal/session`, { method: 'POST', headers: H })).status, 403, 'no CSRF token');
  assert.equal((await fetch(`${BASE}/api/squad-portal/session`, { method: 'POST', headers: { ...H, 'X-CSRF-Token': me.csrf } })).status, 200);
  assert.equal((await fetch(`${BASE}/api/squad-portal/session`, { method: 'POST', headers: { ...H, 'X-CSRF-Token': me.csrf, Origin: 'https://evil.example' } })).status, 403);
  // New device → Super Admin bell.
  const bell = (await fetch(`${BASE}/api/admin/notifications`, { headers: ADMIN }).then(r => r.json())).items;
  assert.ok(bell.some(i => /Squad Data Portal: signed in from/.test(i.title)));
  // A new password signs everyone out.
  password = (await adminCall({ action: 'new_password' })).data.password;
  assert.equal((await fetch(`${BASE}/api/squad-portal/session`, { headers: H })).status, 401);
});

test('wrong passwords: human check after 3, locked for 15 minutes after 5; a new password unlocks', async () => {
  for (let i = 1; i <= 4; i++) {
    const r = await login({ username, password: 'wrong', name: 'Tester' });
    assert.equal(r.status, 401);
    if (i >= 3) assert.equal(r.data.needTurnstile, true, `try ${i}`);
  }
  assert.equal((await login({ username, password: 'wrong', name: 'Tester' })).status, 423, 'locked');
  assert.equal((await login({ username, password, name: 'Tester' })).status, 423, 'even the right password while locked');
  const st = await fetch(`${BASE}/api/squad-portal/status`).then(r => r.json());
  assert.equal(st.locked, true);
  password = (await adminCall({ action: 'new_password' })).data.password;
  assert.equal((await login({ username, password, name: 'Tester' })).status, 200);
});

test('portal off: the sign-in page says it is closed and open sessions end', async () => {
  const ok = await login({ username, password, name: 'Off Test' });
  await adminCall({ action: 'enabled', enabled: false });
  assert.equal((await fetch(`${BASE}/api/squad-portal/status`).then(r => r.json())).open, false);
  assert.equal((await login({ username, password, name: 'Off Test' })).data.closed, true);
  assert.equal((await fetch(`${BASE}/api/squad-portal/session`, { headers: { Cookie: ok.cookie } })).status, 401);
  await adminCall({ action: 'enabled', enabled: true });
});

test('forgot the password: the request reaches the Super Admins (settings, bell, log); nothing secret comes back; limited', async () => {
  const forgot = (b, from = ip()) => fetch(`${BASE}/api/squad-portal/forgot`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': from }, body: JSON.stringify(b) }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
  await adminCall({ action: 'enabled', enabled: true });
  assert.equal((await forgot({ name: '', contact: '08035550000' })).data.field, 'name');
  assert.equal((await forgot({ name: 'Grace', contact: '' })).data.field, 'contact');
  const who = `Forgetful ${uid()}`;
  const r = await forgot({ name: who, contact: '0803 555 0000' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(Object.keys(r.data), ['ok'], 'no password or secret in the answer');
  const s = (await adminCall()).data;
  assert.equal(s.resetRequest.name, who); assert.equal(s.resetRequest.contact, '0803 555 0000');
  const bell = (await fetch(`${BASE}/api/admin/notifications`, { headers: ADMIN }).then(x => x.json())).items;
  assert.ok(bell.some(i => i.title === `Squad Data Portal: ${who} asked for a new password`));
  // A new password clears the request; "Ignore" also does.
  const fresh = await adminCall({ action: 'new_password' });
  password = fresh.data.password;
  assert.equal(fresh.data.resetRequest, null);
  await forgot({ name: who, contact: '0803 555 0000' });
  assert.equal((await adminCall({ action: 'dismiss_request' })).data.resetRequest, null);
  // 3 an hour per connection.
  const one = ip();
  for (let i = 0; i < 3; i++) assert.equal((await forgot({ name: who, contact: '08035550000' }, one)).status, 200);
  assert.equal((await forgot({ name: who, contact: '08035550000' }, one)).status, 429);
  await adminCall({ action: 'dismiss_request' });
  // The sign-in page has the link.
  assert.match(await fetch(`${BASE}/staff/squad-data/`).then(x => x.text()), /Forgot the password\?/);
});
