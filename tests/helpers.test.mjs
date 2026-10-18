// Matchday helper accounts: the Matchday Operations Manager makes gate and
// kitchen helpers for one match (username + PIN, one-time link); helpers see only
// their own screen, stay signed in all match day (no idle timeout), stop at the
// end time, can be switched off, and their name is recorded on scans.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123, STAFF_TEST_PASSWORDS=1,
// PASSWORD_BREACH_CHECK=off. Edits the LOCAL D1.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const localSql = sql => execSync(`npx wrangler d1 execute lobi-stars-tickets --local --command "${sql.replace(/"/g, '\\"')}"`, { stdio: 'pipe' });
const api = (path, method = 'GET', body, headers = ADMIN) => fetch(BASE + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
  .then(async r => ({ status: r.status, headers: r.headers, data: await r.json().catch(() => ({})) }));
const cookieOf = r => ((r.headers.getSetCookie?.() || []).find(c => c.startsWith('ls_admin=')) || '').split(';')[0];
const made = [];
let eventId;
after(async () => {
  for (const id of made) await api(`/api/admin/staff/${id}`, 'PUT', { active: false, reason: 'test finished' });
  if (eventId) await api(`/api/admin/events/${eventId}`, 'DELETE');
});
async function staff(role) {
  const email = `hlp-${role}-${uid()}@example.com`;
  const r = await api('/api/admin/staff', 'POST', { name: `Hlp ${role}`, email, role, password: 'Role-Test-2026!' });
  made.push(r.data.id);
  const l = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
  return { Cookie: cookieOf(l) };
}
const helperLogin = body => fetch(`${BASE}/api/helper/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify(body) })
  .then(async r => ({ status: r.status, data: await r.json().catch(() => ({})), cookie: cookieOf(r) }));

let ops, gate, kitchen;
test('the Matchday Operations Manager makes helpers for a match (username, PIN, one-time QR link)', async () => {
  const ev = await api('/api/admin/events', 'POST', { home_team: 'Lobi Stars FC', away_team: `Helper Test ${uid()}`, venue: 'McCarthy Stadium, Makurdi', event_date: new Date(Date.now() + 2 * 3600e3).toISOString(), vip_price_kobo: 0, premium_price_kobo: 0, regular_price_kobo: 0, active: false });
  eventId = ev.data.id;
  ops = await staff('matchday_ops_manager');
  assert.equal((await api('/api/admin/helpers', 'GET', null, await staff('fan_support'))).status, 403, 'only the Ops Manager (and Super Admins)');
  assert.ok((await api(`/api/admin/helpers?event=${eventId}`, 'GET', null, ops)).data.matches.some(m => m.id === eventId));
  assert.equal((await api('/api/admin/helpers', 'POST', { action: 'create', name: 'X', kind: 'gate', eventId }, ops)).status, 400, 'a real name');
  const g = await api('/api/admin/helpers', 'POST', { action: 'create', name: 'Terver Gate', phone: '0803 123 4567', kind: 'gate', eventId }, ops);
  assert.equal(g.status, 200, JSON.stringify(g.data));
  assert.match(g.data.username, /^gate-terver-\d{4}$/); assert.match(g.data.pin, /^\d{6}$/);
  assert.match(g.data.link, /\/helper\/\?t=[a-f0-9]{48}$/); assert.match(g.data.qr, /^data:image\/png;base64,/);
  gate = g.data;
  const k = await api('/api/admin/helpers', 'POST', { action: 'create', name: 'Ngozi Kitchen', kind: 'kitchen', eventId }, ops);
  kitchen = k.data;
  const list = (await api('/api/admin/helpers', 'GET', null, ops)).data.helpers;
  assert.equal(list.find(h => h.username === gate.username).status, 'active');
  assert.ok((await api('/api/admin/activity')).data.log.some(l => l.action === 'helper_created' && l.detail.includes('Terver Gate')));
});

test('a gate helper signs in with username + PIN, sees only the scanner, and their name is recorded', async () => {
  assert.equal((await helperLogin({ username: gate.username, pin: '000000' })).status, 401);
  const l = await helperLogin({ username: gate.username.toUpperCase(), pin: gate.pin });
  assert.equal(l.status, 200, JSON.stringify(l.data)); assert.equal(l.data.screen, '/scan/');
  const h = { Cookie: l.cookie };
  const me = (await api('/api/admin/me', 'GET', null, h)).data.admin;
  assert.equal(me.roleId, 'gate_staff'); assert.equal(me.helper, true); assert.deepEqual(me.permissions, ['commerce.gate_scan']);
  // The scanner accepts the helper's login (no shared staff code).
  const scan = await api('/api/validate-ticket', 'POST', { ticketId: 'LS-TIX-NOPE-0000' }, { ...h, 'Content-Type': 'application/json' });
  assert.equal(scan.status, 404, 'signed in: the ticket is checked'); assert.equal(scan.data.code, 'not_found');
  assert.equal((await api('/api/validate-ticket', 'POST', { ticketId: 'LS-TIX-NOPE-0000' }, {})).status, 401, 'nobody signed in: refused');
  // Nothing else opens.
  const dash = await fetch(`${BASE}/admin/dashboard/`, { headers: h, redirect: 'manual' });
  assert.equal(dash.status, 302); assert.match(dash.headers.get('location'), /\/scan\/$/);
  for (const p of ['/api/admin/dashboard', '/api/admin/fans', '/api/admin/notifications', '/api/admin/account', '/api/admin/kitchen/orders']) assert.equal((await api(p, 'GET', null, h)).status, 403, p);
  // A whole match day without touching the phone: still signed in.
  const sid = l.cookie.split('.')[1];
  localSql(`UPDATE admin_sessions SET last_seen = ${Date.now() - 3 * 3600e3} WHERE id = '${sid}'`);
  assert.equal((await api('/api/admin/me', 'GET', null, h)).status, 200, 'no 30-minute timeout for helpers');
});

test('a kitchen helper signs in with the one-time link and sees only the Kitchen order board', async () => {
  const t = new URL(kitchen.link).searchParams.get('t');
  const l = await helperLogin({ token: t });
  assert.equal(l.status, 200); assert.equal(l.data.screen, '/admin/kitchen/');
  assert.equal((await helperLogin({ token: t })).status, 401, 'the link works once');
  const h = { Cookie: l.cookie };
  assert.equal((await fetch(`${BASE}/admin/kitchen/`, { headers: h, redirect: 'manual' })).status, 200);
  assert.equal((await api('/api/admin/kitchen/orders', 'GET', null, h)).status, 200);
  assert.equal((await api('/api/admin/kitchen/settings', 'POST', {}, h)).status, 403, 'not the alert settings');
  assert.equal((await api('/api/admin/food-orders', 'GET', null, h)).status, 403, 'no customer details');
  const fans = await fetch(`${BASE}/admin/fans/`, { headers: h, redirect: 'manual' });
  assert.equal(fans.status, 302); assert.match(fans.headers.get('location'), /\/admin\/kitchen\/$/);
});

test('helpers stop at the end time; switched off = signed out at once; 5 wrong PINs lock; a new PIN replaces the old', async () => {
  const l = await helperLogin({ username: gate.username, pin: gate.pin });
  const h = { Cookie: l.cookie };
  // Switched off by the Ops Manager.
  const id = (await api('/api/admin/helpers', 'GET', null, ops)).data.helpers.find(x => x.username === gate.username).id;
  assert.equal((await api('/api/admin/helpers', 'POST', { action: 'disable', id }, ops)).status, 200);
  assert.equal((await api('/api/admin/me', 'GET', null, h)).status, 401);
  assert.match((await helperLogin({ username: gate.username, pin: gate.pin })).data.error, /switched off/);
  // Switched on again with a later finish, then past the end time.
  const later = new Date(Date.now() + 3600e3).toISOString();
  assert.equal((await api('/api/admin/helpers', 'POST', { action: 'extend', id, endsAt: later }, ops)).status, 200);
  const l2 = await helperLogin({ username: gate.username, pin: gate.pin });
  assert.equal(l2.status, 200);
  localSql(`UPDATE matchday_helpers SET expires_at = ${Date.now() - 1000} WHERE id = '${id}'`);
  assert.equal((await api('/api/admin/me', 'GET', null, { Cookie: l2.cookie })).status, 401, 'finished');
  assert.match((await helperLogin({ username: gate.username, pin: gate.pin })).data.error, /match day/);
  assert.equal((await api('/api/admin/helpers', 'GET', null, ops)).data.helpers.find(x => x.id === id).status, 'expired');
  // Lockout and a new PIN (kitchen helper).
  const kid = (await api('/api/admin/helpers', 'GET', null, ops)).data.helpers.find(x => x.username === kitchen.username).id;
  for (let i = 0; i < 5; i++) await helperLogin({ username: kitchen.username, pin: '111111' });
  assert.match((await helperLogin({ username: kitchen.username, pin: kitchen.pin })).data.error, /wait 15 minutes/i);
  const fresh = await api('/api/admin/helpers', 'POST', { action: 'reset', id: kid }, ops);
  assert.equal(fresh.status, 200); assert.notEqual(fresh.data.pin, kitchen.pin);
  assert.equal((await helperLogin({ username: kitchen.username, pin: fresh.data.pin })).status, 200, 'the new PIN works (and ends the lockout)');
  assert.equal((await helperLogin({ username: kitchen.username, pin: kitchen.pin })).status, 401, 'the old PIN no longer works');
});
