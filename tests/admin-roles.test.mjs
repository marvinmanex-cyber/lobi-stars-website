// Admin roles: each staff role only sees and opens its own areas, checked on
// the server for pages and APIs (typing a URL directly is refused too).
// Needs the local Pages dev server with ADMIN_CODE=test-code-123.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const made = [];

async function staff(role, canExport = false) {
  const email = `role-${role}-${uid()}@example.com`;
  const r = await fetch(`${BASE}/api/admin/staff`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ name: `Test ${role}`, email, password: 'Role-Test-2026!', role, canExport }) });
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  made.push(d.id);
  const login = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
  assert.equal(login.status, 200);
  return login.headers.get('set-cookie').split(';')[0];
}
const call = (cookie, path, method = 'GET', body) => fetch(BASE + path, { method, redirect: 'manual', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

after(async () => { for (const id of made) await fetch(`${BASE}/api/admin/staff/${id}`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ active: false }) }); });

test('a role must be chosen when creating staff; roles are listed for Super Admins only', async () => {
  const r = await fetch(`${BASE}/api/admin/staff`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ name: 'No Role', email: `nr-${uid()}@example.com`, password: 'Role-Test-2026!' }) });
  assert.equal(r.status, 400);
  const list = await (await fetch(`${BASE}/api/admin/staff`, { headers: ADMIN })).json();
  assert.ok(list.roles.some(x => x.id === 'fan_relations'));
  const fr = await staff('fan_relations');
  assert.equal((await call(fr, '/api/admin/staff')).status, 403);
  const sa = await staff('super_admin');
  assert.equal((await call(sa, '/api/admin/staff')).status, 200);
});

test('analyst: analytics only, read-only; other screens and APIs refused', async () => {
  const c = await staff('analyst');
  const me = (await (await call(c, '/api/admin/me')).json()).admin;
  assert.deepEqual(me.areas.sort(), ['analytics', 'overview']);
  assert.equal(me.roleLabel, 'Analyst (read-only)');
  assert.equal((await call(c, '/api/admin/analytics?range=7d')).status, 200);
  assert.equal((await call(c, '/api/admin/fans')).status, 403);
  assert.equal((await call(c, '/api/admin/events')).status, 403);
  assert.equal((await call(c, '/admin/analytics/')).status, 200);
  assert.equal((await call(c, '/admin/dashboard/')).status, 200);
  const page = await call(c, '/admin/fans/');
  assert.equal(page.status, 302);
  assert.match(page.headers.get('location'), /\/admin\/dashboard\/\?denied=1/);
  assert.equal((await call(c, '/admin/')).status, 302, 'no content CMS');
  const d = await (await call(c, '/api/admin/dashboard')).json();
  assert.ok(d.pageViews, 'page views card');
  assert.equal(d.messages, undefined, 'no messages card');
});

test('fan relations: fans & members, not matchday; matchday operator: matchday, not fans', async () => {
  const fr = await staff('fan_relations');
  assert.equal((await call(fr, '/api/admin/fans')).status, 200);
  assert.equal((await call(fr, '/api/admin/members')).status, 200);
  assert.equal((await call(fr, '/api/admin/events')).status, 403);
  assert.equal((await call(fr, '/admin/match-centre/')).status, 302);
  const d = await (await call(fr, '/api/admin/dashboard')).json();
  assert.ok(d.messages && d.contacts);
  assert.equal(d.pageViews, undefined);

  const md = await staff('matchday');
  assert.equal((await call(md, '/api/admin/fans')).status, 403);
  const ev = await call(md, '/api/admin/events', 'POST', { home_team: 'Lobi Stars FC', away_team: `Role Test ${uid()}`, venue: 'McCarthy Stadium, Makurdi', event_date: new Date(Date.now() + 86400e3 * 9).toISOString(), vip_price_kobo: 0, premium_price_kobo: 0, regular_price_kobo: 0, active: false });
  assert.equal(ev.status, 200);
  const { id } = await ev.json();
  assert.equal((await call(md, `/api/admin/events/${id}`, 'DELETE')).status, 200);
});

test('media: content and the Match Centre (view), but cannot change matches; commercial: commerce and partners', async () => {
  const m = await staff('media');
  assert.equal((await call(m, '/api/admin/awards')).status, 200);
  assert.equal((await call(m, '/api/admin/events')).status, 200);
  assert.equal((await call(m, '/api/admin/events', 'POST', {})).status, 403);
  assert.equal((await call(m, '/admin/match-centre/')).status, 200);
  assert.equal((await call(m, '/admin/predictions/')).status, 302);

  const c = await staff('commercial');
  assert.equal((await call(c, '/api/admin/shirt-orders')).status, 200);
  assert.equal((await call(c, '/admin/partners/')).status, 200);
  assert.equal((await call(c, '/api/admin/fans')).status, 403);
  assert.equal((await call(c, '/api/admin/partner-report')).status !== 403, true);
});

test('admin search only returns what the role can open', async () => {
  const fr = await staff('fan_relations');
  const res = await (await call(fr, '/api/admin/search?q=lobi')).json();
  assert.ok(Array.isArray(res.results));
  assert.ok(!res.results.some(r => r.type === 'Match' || r.type === 'News'));
  const owner = await (await fetch(`${BASE}/api/admin/search?q=lobi`, { headers: ADMIN })).json();
  assert.ok(owner.results.some(r => r.type === 'Match'));
});

test('admin pages: own shell, noindex, no public header; old URLs still work', async () => {
  for (const path of ['/admin/dashboard/', '/admin/matches/', '/admin/fans/', '/admin/analytics/', '/admin/activity/']) {
    const r = await fetch(BASE + path, { headers: ADMIN, redirect: 'manual' });
    // The owner signs in with a cookie in the browser; with the header only, pages still redirect to login.
    assert.ok([200, 302].includes(r.status), path);
  }
  const login = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ code: process.env.ADMIN_CODE || 'test-code-123' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const html = await (await call(cookie, '/admin/dashboard/')).text();
  assert.match(html, /class="ash-side"/);
  assert.match(html, /noindex/);
  assert.doesNotMatch(html, /id="siteHeader"/);
  assert.match(html, /Skip to content/);
  for (const path of ['/admin/matches/', '/admin/match-centre/', '/admin/predictions/', '/admin/commentary/', '/admin/news/', '/admin/awards/', '/admin/fans/', '/admin/members/', '/admin/shirt-orders/', '/admin/partners/', '/admin/analytics/', '/admin/staff/', '/admin/activity/']) {
    const r = await call(cookie, path);
    assert.equal(r.status, 200, path);
  }
  const robots = await (await fetch(`${BASE}/robots.txt`)).text();
  assert.match(robots, /Disallow: \/admin/);
});
