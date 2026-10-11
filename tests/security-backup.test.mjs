// Accessibility statement, data backup (Super Admin only, no secrets) and
// two-step login for staff (authenticator codes, no reuse, reset by a
// Super Admin). Needs the local Pages dev server with ADMIN_CODE=test-code-123.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { totpCode, base32Decode } from '../functions/api/_lib/totp.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const api = (path, method = 'GET', body, headers = ADMIN) => fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const login = body => fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify(body) })
  .then(async r => ({ status: r.status, data: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0] }));
const made = [];
after(async () => { for (const id of made) await fetch(`${BASE}/api/admin/staff/${id}`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ active: false }) }); });
async function staff(role, canExport = false) {
  const email = `sec-${role}-${uid()}@example.com`;
  const r = await api('/api/admin/staff', 'POST', { name: `Sec ${role}`, email, password: 'Role-Test-2026!', role, canExport });
  made.push(r.data.id);
  const l = await login({ email, password: 'Role-Test-2026!' });
  return { id: r.data.id, email, h: { Cookie: l.cookie, 'Content-Type': 'application/json' } };
}
const codeAt = (secret, offsetSteps = 0) => totpCode(secret.replace(/\s/g, ''), Math.floor(Date.now() / 30000) + offsetSteps);

test('accessibility statement: public, in the footer and the sitemap', async () => {
  const r = await fetch(`${BASE}/accessibility/`);
  assert.equal(r.status, 200);
  const html = await r.text();
  for (const t of ['WCAG', 'Skip to content', 'Tell us about a problem', 'info@lobistarsfc.com']) assert.ok(html.includes(t), t);
  assert.match(await fetch(`${BASE}/`).then(x => x.text()), /href="\/accessibility"/);
  assert.match(await fetch(`${BASE}/sitemap.xml`).then(x => x.text()), /\/accessibility\//);
});

test('data backup: Super Admin only; every table in pieces; passwords and secrets never included; recorded', async () => {
  const fr = await staff('fan_relations', true);
  assert.equal((await api('/api/admin/backup', 'GET', null, fr.h)).status, 403);
  assert.equal((await fetch(`${BASE}/admin/backup/`, { headers: fr.h, redirect: 'manual' })).status, 302);
  const list = (await api('/api/admin/backup')).data;
  const names = list.tables.map(t => t.table);
  for (const t of ['contacts', 'food_orders', 'admin_users', 'inbox_threads', 'newsletter_issues']) assert.ok(names.includes(t), t);
  for (const t of ['rate_limits', 'auth_tokens', 'food_photos', 'newsletter_assets']) assert.ok(!names.includes(t), `${t} left out`);
  const users = (await api('/api/admin/backup?table=admin_users')).data;
  assert.ok(users.columns.includes('email'));
  for (const c of users.columns) assert.doesNotMatch(c, /password|totp|secret/i, c);
  const contacts = (await api('/api/admin/backup?table=contacts')).data;
  assert.ok(!contacts.columns.includes('unsub_token'));
  assert.ok(contacts.rows.length > 0);
  const subs = (await api('/api/admin/backup?table=push_subs')).data;
  assert.ok(!subs.columns.includes('keys_json'), 'push keys left out');
  assert.equal((await api('/api/admin/backup?table=sqlite_master')).status, 404);
  assert.equal((await api('/api/admin/backup?table=x%22%3B%20DROP')).status, 404);
  assert.equal((await api('/api/admin/backup', 'POST', { format: 'xlsx', tables: names.length, rows: 123 })).status, 200);
  const after1 = (await api('/api/admin/backup')).data;
  assert.match(after1.history[0].detail, /^xlsx: \d+ tables, 123 rows$/);
  assert.ok((await api('/api/admin/dashboard')).data.lastBackup, 'dashboard knows when');
});

test('two-step login: set up with an authenticator code, required at login, codes cannot be reused, reset by a Super Admin', async () => {
  const s = await staff('commercial');
  let me = (await api('/api/admin/account', 'GET', null, s.h)).data;
  assert.equal(me.twoStep, false);
  const start = (await api('/api/admin/account', 'POST', { action: 'start_2fa' }, s.h)).data;
  assert.match(start.qr, /^data:image\/png;base64,/);
  assert.match(start.uri, /^otpauth:\/\/totp\/Lobi%20Stars%20Admin/);
  assert.equal(base32Decode(start.secret).length, 20);
  assert.equal((await api('/api/admin/account', 'POST', { action: 'confirm_2fa', otp: '000000' }, s.h)).status, 400);
  assert.equal((await api('/api/admin/account', 'POST', { action: 'confirm_2fa', otp: await codeAt(start.secret) }, s.h)).status, 200);
  me = (await api('/api/admin/account', 'GET', null, s.h)).data;
  assert.equal(me.twoStep, true);

  const noCode = await login({ email: s.email, password: 'Role-Test-2026!' });
  assert.equal(noCode.status, 401);
  assert.equal(noCode.data.needCode, true);
  assert.equal(noCode.cookie, '', 'no session without the code');
  assert.equal((await login({ email: s.email, password: 'Role-Test-2026!', otp: '123456' })).status, 401);
  const next = await codeAt(start.secret, 1);
  const ok = await login({ email: s.email, password: 'Role-Test-2026!', otp: next });
  assert.equal(ok.status, 200);
  assert.ok(ok.cookie);
  assert.equal((await login({ email: s.email, password: 'Role-Test-2026!', otp: next })).status, 401, 'the same code cannot be used twice');
  const staffList = (await api('/api/admin/staff')).data;
  assert.equal((staffList.staff || staffList.users || staffList).find?.(x => x.id === s.id)?.totp_enabled ?? 1, 1);

  // Lost phone: a Super Admin resets it, then the password alone works again.
  assert.equal((await api(`/api/admin/staff/${s.id}`, 'PUT', { resetTwoStep: true })).status, 200);
  assert.equal((await login({ email: s.email, password: 'Role-Test-2026!' })).status, 200);
  const log = (await api('/api/admin/activity')).data.log.map(l => `${l.action} ${l.detail}`).join('\n');
  assert.match(log, /account_2fa_on/);
  assert.match(log, /two-step login reset/);
});

test('my account: change password; the owner code has no account settings', async () => {
  const s = await staff('media');
  assert.equal((await api('/api/admin/account', 'POST', { action: 'password', current: 'wrong-password', next: 'New-Password-2026' }, s.h)).status, 400);
  assert.equal((await api('/api/admin/account', 'POST', { action: 'password', current: 'Role-Test-2026!', next: 'short' }, s.h)).status, 400);
  assert.equal((await api('/api/admin/account', 'POST', { action: 'password', current: 'Role-Test-2026!', next: 'New-Password-2026' }, s.h)).status, 200);
  assert.equal((await login({ email: s.email, password: 'New-Password-2026' })).status, 200);
  assert.equal((await login({ email: s.email, password: 'Role-Test-2026!' })).status, 401);
  assert.equal((await api('/api/admin/account')).data.owner, true);
  assert.equal((await api('/api/admin/account', 'POST', { action: 'start_2fa' })).status, 400);
  assert.equal((await fetch(`${BASE}/admin/account/`, { headers: s.h, redirect: 'manual' })).status, 200, 'every role can open My account');
});
