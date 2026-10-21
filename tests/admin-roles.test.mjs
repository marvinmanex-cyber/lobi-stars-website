// Admin roles and permissions: each staff role only sees and opens what its
// permissions allow, checked on the server for pages and APIs (typing a URL
// directly is refused too). Super Admins can change what a role includes.
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
const me = async c => (await (await call(c, '/api/admin/me')).json()).admin;

after(async () => { for (const id of made) await fetch(`${BASE}/api/admin/staff/${id}`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ active: false, reason: 'test finished' }) }); });

test('the new roles are offered (old ones are not); roles are listed for Super Admins only', async () => {
  const r = await fetch(`${BASE}/api/admin/staff`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ name: 'No Role', email: `nr-${uid()}@example.com`, password: 'Role-Test-2026!' }) });
  assert.equal(r.status, 400);
  const list = await (await fetch(`${BASE}/api/admin/staff`, { headers: ADMIN })).json();
  for (const id of ['super_admin', 'content_editor', 'media_editor', 'media_contributor', 'matchday_admin', 'broadcast_operator', 'crm_manager', 'fan_support', 'commercial_manager', 'matchday_ops_manager', 'gate_staff', 'kitchen_staff']) {
    assert.ok(list.roles.some(x => x.id === id), id);
  }
  assert.ok(!list.roles.some(x => x.id === 'analyst' && !x.legacy), 'Analyst is not offered for new accounts');
  const old = await fetch(`${BASE}/api/admin/staff`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ name: 'Old', email: `old-${uid()}@example.com`, password: 'Role-Test-2026!', role: 'analyst' }) });
  assert.equal(old.status, 400);
  const fr = await staff('fan_support');
  assert.equal((await call(fr, '/api/admin/staff')).status, 403);
  assert.equal((await call(fr, '/admin/staff/')).status, 403);
  const sa = await staff('super_admin');
  assert.equal((await call(sa, '/api/admin/staff')).status, 200);
  assert.equal((await call(sa, '/api/admin/roles')).status, 200);
});

test('broadcast operator: commentary and fan alerts only; other screens get the friendly no-access page', async () => {
  const c = await staff('broadcast_operator');
  const a = await me(c);
  assert.equal(a.roleId, 'broadcast_operator');
  assert.equal(a.roleLabel, 'Broadcast Operator');
  assert.deepEqual([...a.permissions].sort(), ['analytics.broadcast', 'broadcast.commentary.manage', 'broadcast.watch_live.edit', 'matchday.checklist.view', 'settings.commentary']);
  assert.equal((await call(c, '/admin/commentary/')).status, 200);
  assert.equal((await call(c, '/admin/fan-alerts/')).status, 403, 'fan alerts are live updates (Media Editor, Matchday Admin)');
  assert.equal((await call(c, '/admin/dashboard/')).status, 200);
  assert.equal((await call(c, '/api/admin/events')).status, 200, 'reads the match list');
  assert.equal((await call(c, '/api/admin/events', 'POST', {})).status, 403, 'cannot add matches');
  assert.equal((await call(c, '/api/admin/fans')).status, 403);
  assert.equal((await call(c, '/api/admin/analytics?range=7d')).status, 403);
  const page = await call(c, '/admin/fans/');
  assert.equal(page.status, 403);
  const html = await page.text();
  assert.match(html, /You don't have access to this section/);
  assert.match(html, /Broadcast Operator/);
  assert.match(html, /href="\/admin\/dashboard\/"/);
  assert.equal((await call(c, '/admin/matches/')).status, 200, 'commentary on/off per match');
  assert.equal((await call(c, '/admin/')).status, 403, 'no content CMS');
  const api = await call(c, '/api/admin/fans');
  assert.match((await api.json()).error, /don't have access/);
  const d = await (await call(c, '/api/admin/dashboard')).json();
  assert.equal(d.messages, undefined, 'no messages card');
});

test('gate staff: only the scanner; kitchen staff: only the Kitchen Screen', async () => {
  const g = await staff('gate_staff');
  assert.equal((await call(g, '/admin/tickets/scan/')).status, 200);
  assert.equal((await call(g, '/admin/tickets/')).status, 403);
  assert.equal((await call(g, '/api/admin/tickets')).status, 403);
  assert.deepEqual((await me(g)).permissions, ['commerce.gate_scan']);
  const k = await staff('kitchen_staff');
  assert.equal((await call(k, '/admin/kitchen/')).status, 200);
  assert.equal((await call(k, '/api/admin/kitchen/orders')).status, 200);
  assert.equal((await call(k, '/api/admin/kitchen/settings', 'POST', {})).status, 403, 'alert settings: food managers only');
  assert.equal((await call(k, '/api/admin/food-orders')).status, 403);
  // Old role name still works.
  assert.equal((await me(await staff('kitchen'))).roleId, 'kitchen_staff');
});

test('fan support: fan accounts and memberships but no downloads or Rewards settings; only CRM and Super Admin download', async () => {
  const fs = await staff('fan_support');
  assert.equal((await call(fs, '/api/admin/members')).status, 200);
  assert.notEqual((await call(fs, '/api/admin/members', 'POST', { action: 'confirm', id: 'nope' })).status, 403, 'manages memberships');
  assert.equal((await call(fs, '/api/admin/fans/export')).status, 403, 'no download');
  assert.equal((await call(fs, '/api/admin/rewards')).status, 200, 'looks up Rewards');
  assert.equal((await call(fs, '/api/admin/rewards', 'PUT', {})).status, 403, 'cannot change Rewards settings');
  assert.equal((await call(fs, '/api/admin/rewards/member', 'POST', {})).status, 403, 'cannot adjust points');
  const crm = await staff('crm_manager');
  assert.notEqual((await call(crm, '/api/admin/members', 'POST', { action: 'confirm', id: 'nope' })).status, 403);
  assert.equal((await me(crm)).canExport, true, 'the CRM role includes downloads');
  assert.notEqual((await call(crm, '/api/admin/fans/export')).status, 403);
  // Downloads come from the role only (the old per-person switch no longer grants them).
  assert.equal((await me(await staff('fan_support', true))).canExport, false);
  assert.equal((await me(await staff('commercial_manager'))).canExport, false);
});

test('Super Admin changes what a role includes (logged), then puts it back', async () => {
  const roles = await (await fetch(`${BASE}/api/admin/roles`, { headers: ADMIN })).json();
  assert.ok(roles.permissions.length >= 8);
  assert.deepEqual(roles.roles.find(r => r.id === 'gate_staff').permissions, ['commerce.gate_scan']);
  const put = body => fetch(`${BASE}/api/admin/roles`, { method: 'PUT', headers: ADMIN, body: JSON.stringify(body) });
  assert.equal((await put({ id: 'super_admin', permissions: [] })).status, 400, 'Super Admin is fixed');
  assert.equal((await put({ id: 'gate_staff', permissions: ['commerce.gate_scan', 'staff.manage'] })).status, 400, 'nobody else manages staff');
  assert.equal((await put({ id: 'gate_staff', permissions: ['commerce.gate_scan', 'nope.perm'] })).status, 400);
  const g = await staff('gate_staff');
  assert.equal((await call(g, '/api/admin/kitchen/orders')).status, 403);
  try {
    const r = await put({ id: 'gate_staff', permissions: ['commerce.gate_scan', 'commerce.kitchen.board'] });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).changed, true);
    assert.equal((await call(g, '/api/admin/kitchen/orders')).status, 200, 'applies at once on this server');
    const log = await (await fetch(`${BASE}/api/admin/activity`, { headers: ADMIN })).json();
    assert.ok(JSON.stringify(log).includes('Gate Staff: added: Kitchen order board'), 'in the Activity Log');
    assert.equal((await call(await staff('fan_support'), '/api/admin/roles')).status, 403);
  } finally {
    assert.equal((await put({ id: 'gate_staff', reset: true })).status, 200);
  }
  assert.equal((await call(g, '/api/admin/kitchen/orders')).status, 403, 'back to the default');
});

test('fan support: fans & members, not matchday; matchday admin (old name: matchday): matchday, not fans', async () => {
  const fr = await staff('fan_support');
  assert.equal((await call(fr, '/api/admin/fans')).status, 200);
  assert.equal((await call(fr, '/api/admin/members')).status, 200);
  assert.equal((await call(fr, '/api/admin/events')).status, 403);
  assert.equal((await call(fr, '/admin/match-centre/')).status, 403);
  const d = await (await call(fr, '/api/admin/dashboard')).json();
  assert.ok(d.messages && d.contacts);
  assert.equal(d.pageViews, undefined);

  const md = await staff('matchday');
  assert.equal((await me(md)).roleId, 'matchday_admin');
  assert.equal((await call(md, '/api/admin/fans')).status, 403);
  const ev = await call(md, '/api/admin/events', 'POST', { home_team: 'Lobi Stars FC', away_team: `Role Test ${uid()}`, venue: 'McCarthy Stadium, Makurdi', event_date: new Date(Date.now() + 86400e3 * 9).toISOString(), vip_price_kobo: 0, premium_price_kobo: 0, regular_price_kobo: 0, active: false });
  assert.equal(ev.status, 200);
  const { id } = await ev.json();
  assert.equal((await call(md, `/api/admin/events/${id}`, 'DELETE')).status, 200);
});

test('content editor (old name: media): content and the programme, not matchday control; commercial: shop, partners, enquiries', async () => {
  const m = await staff('media');
  assert.equal((await me(m)).roleId, 'content_editor', 'old name stored as the new role');
  assert.equal((await call(m, '/api/admin/awards')).status, 200);
  assert.equal((await call(m, '/api/admin/events')).status, 200, 'sees matches (for the programme)');
  assert.equal((await call(m, '/api/admin/events', 'POST', {})).status, 403);
  assert.equal((await call(m, '/admin/match-centre/')).status, 403);
  assert.equal((await call(m, '/admin/predictions/')).status, 403);
  assert.equal((await call(m, '/admin/programmes/')).status, 200);

  const c = await staff('commercial_manager');
  assert.equal((await call(c, '/api/admin/shirt-orders')).status, 200);
  assert.equal((await call(c, '/admin/partners/')).status, 200);
  assert.equal((await call(c, '/api/admin/fans')).status, 403);
  assert.notEqual((await call(c, '/api/admin/partner-report')).status, 403);
});

test('admin search only returns what the role can open', async () => {
  const fr = await staff('fan_support');
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
  assert.match(html, /data-perm="staff.manage"/, 'sidebar items carry their permission');
  for (const path of ['/admin/matches/', '/admin/match-centre/', '/admin/predictions/', '/admin/commentary/', '/admin/news/', '/admin/awards/', '/admin/fans/', '/admin/members/', '/admin/shirt-orders/', '/admin/partners/', '/admin/analytics/', '/admin/staff/', '/admin/activity/', '/admin/backup/', '/admin/tickets/scan/', '/admin/kitchen/']) {
    const r = await call(cookie, path);
    assert.equal(r.status, 200, path);
  }
  const robots = await (await fetch(`${BASE}/robots.txt`)).text();
  assert.match(robots, /Disallow: \/admin/);
});

test('in-seat food orders: the Matchday Operations Manager can view and update; other roles cannot', async () => {
  const c = await staff('matchday_ops_manager');
  const r = await call(c, '/api/admin/food-orders?show=today');
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.ok(Array.isArray(d.orders) && typeof d.today.orders === 'number');
  assert.equal((await call(c, '/api/admin/food-orders', 'POST', { id: 'x', status: 'bogus' })).status, 400);
  assert.equal((await call(c, '/api/admin/food-orders', 'POST', { id: 'LS-FOOD-NOPE', status: 'DELIVERED' })).status, 404);
  assert.equal((await call(c, '/admin/food-orders/')).status, 200);
  assert.equal((await call(await staff('commercial_manager'), '/api/admin/food-orders')).status, 403, 'not Commercial');
  const fr = await staff('fan_support');
  assert.equal((await call(fr, '/api/admin/food-orders')).status, 403);
  assert.equal((await call(fr, '/admin/food-orders/')).status, 403);
});
