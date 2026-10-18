// Staff login security (Phase 2): password rules, "choose your own password"
// first, login sessions (log out, log out of all devices, idle timeout,
// deactivation signs out at once), lockout after wrong attempts and the human
// check, backup codes, requiring two-step login (only once a Super Admin has it
// working), the IP allowlist (cannot lock yourself out; the owner code always
// works), requests from other websites refused, strict headers on admin pages.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123 and
// PASSWORD_BREACH_CHECK=off. Edits the LOCAL D1 database.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { totpCode } from '../functions/api/_lib/totp.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const PW = 'Role-Test-2026!';
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const localSql = sql => execSync(`npx wrangler d1 execute lobi-stars-tickets --local --command "${sql.replace(/"/g, '\\"')}"`, { stdio: 'pipe' });
const api = (path, method = 'GET', body, headers = ADMIN) => fetch(BASE + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
  .then(async r => ({ status: r.status, headers: r.headers, data: await r.json().catch(() => ({})) }));
async function login(body, ip = randIp()) {
  const r = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify(body) });
  const cookies = r.headers.getSetCookie?.() || [];
  const s = cookies.find(c => c.startsWith('ls_admin=')) || '';
  return { status: r.status, data: await r.json().catch(() => ({})), cookie: s.split(';')[0], device: (cookies.find(c => c.startsWith('ls_dev=')) || '').split(';')[0], ip };
}
const as = (l, extra = {}) => ({ Cookie: [l.cookie, l.device].filter(Boolean).join('; '), 'CF-Connecting-IP': l.ip, ...extra });
const made = [];
after(async () => {
  await api('/api/admin/security', 'POST', { action: 'require_two_step', on: false });
  await api('/api/admin/security', 'POST', { action: 'ip_allowlist', scope: 'off', list: '' });
  await api('/api/admin/security', 'POST', { action: 'email_domain_only', on: false });
  for (const id of made) await api(`/api/admin/staff/${id}`, 'PUT', { active: false, reason: 'test finished' });
});
async function staff(role, extra = {}) {
  const email = `ls-${role}-${uid()}@example.com`;
  const r = await api('/api/admin/staff', 'POST', { name: `LS ${role}`, email, password: PW, role, ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  made.push(r.data.id);
  return { id: r.data.id, email };
}
const codeAt = (secret, k = 0) => totpCode(secret.replace(/\s/g, ''), Math.floor(Date.now() / 30000) + k);
async function withTwoStep(role) {
  const s = await staff(role);
  const l = await login({ email: s.email, password: PW });
  const start = (await api('/api/admin/account', 'POST', { action: 'start_2fa' }, as(l))).data;
  const on = await api('/api/admin/account', 'POST', { action: 'confirm_2fa', otp: await codeAt(start.secret) }, as(l));
  assert.equal(on.status, 200, JSON.stringify(on.data));
  return { ...s, secret: start.secret, codes: on.data.backupCodes };
}

test('password rules: 12+ characters, not the email or name, not a common password', async () => {
  const email = `pw-${uid()}@example.com`;
  const tryPw = password => api('/api/admin/staff', 'POST', { name: 'Chukwuemeka Obi', email, password, role: 'fan_support' });
  assert.match((await tryPw('Short-1!')).data.error, /at least 12/);
  assert.match((await tryPw(`${email.split('@')[0]}-2026`)).data.error, /email/);
  assert.match((await tryPw('ChukwuemekaObi-2026')).data.error, /name/);
  assert.match((await tryPw('password1234')).data.error, /common/);
  assert.match((await tryPw('aaaaaaaaaaaaaa')).data.error, /easy/);
  // The @lobistarsfc.com rule (off by default).
  assert.equal((await api('/api/admin/security', 'POST', { action: 'email_domain_only', on: true })).status, 200);
  assert.match((await tryPw('A-good-long-pass-2026')).data.error, /@lobistarsfc\.com/);
  await api('/api/admin/security', 'POST', { action: 'email_domain_only', on: false });
});

test('a temporary password must be changed first: until then only My account works', async () => {
  const s = await staff('fan_support', { mustChange: true });
  const l = await login({ email: s.email, password: PW });
  assert.equal(l.status, 200);
  assert.equal(l.data.mustChangePassword, true);
  const fans = await api('/api/admin/fans', 'GET', null, as(l));
  assert.equal(fans.status, 403); assert.equal(fans.data.restrict, 'password');
  const page = await fetch(`${BASE}/admin/fans/`, { headers: as(l), redirect: 'manual' });
  assert.equal(page.status, 302); assert.match(page.headers.get('location'), /\/admin\/account\/\?must=password/);
  assert.equal((await fetch(`${BASE}/admin/account/`, { headers: as(l), redirect: 'manual' })).status, 200);
  assert.equal((await api('/api/admin/account', 'GET', null, as(l))).data.mustChangePassword, true);
  assert.equal((await api('/api/admin/account', 'POST', { action: 'password', current: PW, next: 'short' }, as(l))).status, 400);
  const ch = await api('/api/admin/account', 'POST', { action: 'password', current: PW, next: 'Fresh-Long-Password-26' }, as(l));
  assert.equal(ch.status, 200, JSON.stringify(ch.data));
  assert.equal((await api('/api/admin/fans', 'GET', null, as(l))).status, 200, 'now everything works');
  assert.equal((await login({ email: s.email, password: PW })).status, 401, 'old password gone');
});

test('sessions: log out ends the session on the server; log out of other devices; deactivating signs out at once', async () => {
  const s = await staff('fan_support');
  const a = await login({ email: s.email, password: PW });
  const b = await login({ email: s.email, password: PW });
  assert.match(a.cookie, /^ls_admin=v2\.[a-f0-9]{48}\./);
  assert.ok(a.device.startsWith('ls_dev='), 'this browser is remembered');
  const mine = (await api('/api/admin/account', 'GET', null, as(a))).data.sessions;
  assert.equal(mine.length, 2); assert.equal(mine.filter(x => x.current).length, 1);
  // Copying the cookie after "Log out" doesn't work: the session is gone on the server.
  await api('/api/admin/logout', 'POST', {}, as(b));
  assert.equal((await api('/api/admin/me', 'GET', null, as(b))).status, 401);
  const c = await login({ email: s.email, password: PW });
  assert.equal((await api('/api/admin/account', 'POST', { action: 'logout_others' }, as(a))).data.signedOut, 1);
  assert.equal((await api('/api/admin/me', 'GET', null, as(c))).status, 401);
  assert.equal((await api('/api/admin/me', 'GET', null, as(a))).status, 200, 'this device stays');
  // A Super Admin signs someone out, then deactivates them.
  const d = await login({ email: s.email, password: PW });
  assert.equal((await api(`/api/admin/staff/${s.id}`, 'PUT', { signOut: true })).status, 200);
  assert.equal((await api('/api/admin/me', 'GET', null, as(d))).status, 401);
  const e = await login({ email: s.email, password: PW });
  assert.equal((await api(`/api/admin/staff/${s.id}`, 'PUT', { active: false, reason: 'Left the club' })).status, 200);
  assert.equal((await api('/api/admin/me', 'GET', null, as(e))).status, 401, 'leaver signed out straight away');
  assert.equal((await login({ email: s.email, password: PW })).status, 401);
  // Old-style cookies are no longer accepted.
  assert.equal((await api('/api/admin/me', 'GET', null, { Cookie: 'ls_admin=owner.9999999999999.abc' })).status, 401);
});

test('idle for 30 minutes: signed out; background refreshes do not keep a session open', async () => {
  const s = await staff('fan_support');
  const l = await login({ email: s.email, password: PW });
  const sid = l.cookie.split('.')[1];
  localSql(`UPDATE admin_sessions SET last_seen = ${Date.now() - 20 * 60000} WHERE id = '${sid}'`);
  assert.equal((await api('/api/admin/notifications', 'GET', null, as(l))).status, 200);
  assert.equal((await api('/api/admin/me', 'POST', {}, as(l))).status, 200, '"still here" keeps it open');
  localSql(`UPDATE admin_sessions SET last_seen = ${Date.now() - 31 * 60000} WHERE id = '${sid}'`);
  assert.equal((await api('/api/admin/me', 'GET', null, as(l))).status, 401, 'idle: signed out');
  const page = await fetch(`${BASE}/admin/dashboard/`, { headers: as(l), redirect: 'manual' });
  assert.equal(page.status, 302); assert.match(page.headers.get('location'), /\/admin\/login\//);
});

test('5 wrong attempts lock the account for 15 minutes (the human check appears after 3); a Super Admin can unlock', async () => {
  const s = await staff('fan_support');
  let r;
  for (let i = 1; i <= 4; i++) {
    r = await login({ email: s.email, password: 'Wrong-Password-99' });
    assert.equal(r.status, 401);
    if (i >= 3) assert.equal(r.data.needCaptcha, true, `human check after ${i}`);
  }
  r = await login({ email: s.email, password: 'Wrong-Password-99' });
  assert.equal(r.status, 423); assert.equal(r.data.locked, true);
  r = await login({ email: s.email, password: PW });
  assert.equal(r.status, 423, 'even the right password waits');
  assert.match(r.data.error, /wait 15 minutes/, 'a generic message that does not confirm the account exists');
  const row = (await api('/api/admin/staff')).data.staff.find(x => x.id === s.id);
  assert.ok(row.locked_until, 'shown as locked on the Staff screen');
  assert.equal((await api(`/api/admin/staff/${s.id}`, 'PUT', { unlock: true })).status, 200);
  assert.equal((await login({ email: s.email, password: PW })).status, 200);
  const log = (await api('/api/admin/security')).data.events.map(e => e.action);
  assert.ok(log.includes('account_locked') && log.includes('login_failed'));
});

test('backup codes: 10 when two-step login is turned on; each works once instead of the phone code', async () => {
  const s = await withTwoStep('fan_support');
  assert.equal(s.codes.length, 10);
  assert.ok(s.codes.every(c => /^[a-z2-9]{4}-[a-z2-9]{4}$/.test(c)));
  const first = await login({ email: s.email, password: PW, otp: s.codes[0].toUpperCase().replace('-', ' ') });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal((await login({ email: s.email, password: PW, otp: s.codes[0] })).status, 401, 'used once only');
  assert.equal((await api('/api/admin/account', 'GET', null, as(first))).data.backupCodesLeft, 9);
  // New codes: the old ones stop working.
  const fresh = await api('/api/admin/account', 'POST', { action: 'backup_codes', password: PW, otp: await codeAt(s.secret, 1) }, as(first));
  assert.equal(fresh.status, 200, JSON.stringify(fresh.data));
  assert.equal((await login({ email: s.email, password: PW, otp: s.codes[1] })).status, 401, 'old codes stopped working');
  assert.equal((await login({ email: s.email, password: PW, otp: fresh.data.backupCodes[0] })).status, 200);
});

test('requiring two-step login: refused until a Super Admin has it working; then 7 days, then only My account', async () => {
  await api('/api/admin/security', 'POST', { action: 'require_two_step', on: false });
  // Nobody locked out: a Super Admin must have signed in with two-step login first.
  localSql(`UPDATE admin_users SET twostep_login_at = NULL WHERE role = 'super_admin'`);
  const refused = await api('/api/admin/security', 'POST', { action: 'require_two_step', on: true });
  assert.equal(refused.status, 409); assert.match(refused.data.error, /Super Admin/);
  const sa = await withTwoStep('super_admin');
  assert.equal((await api('/api/admin/security', 'POST', { action: 'require_two_step', on: true })).status, 409, 'turned on but not used to sign in yet');
  assert.equal((await login({ email: sa.email, password: PW, otp: await codeAt(sa.secret, 1) })).status, 200);
  assert.equal((await api('/api/admin/security', 'POST', { action: 'require_two_step', on: true })).status, 200);
  try {
    const s = await staff('fan_support');
    const l = await login({ email: s.email, password: PW });
    const me = (await api('/api/admin/me', 'GET', null, as(l))).data.admin;
    assert.ok(me.twoStepDue, 'has a date to set it up by');
    assert.ok(new Date(me.twoStepDue) - Date.now() > 6.9 * 864e5);
    assert.equal((await api('/api/admin/fans', 'GET', null, as(l))).status, 200, 'works during the 7 days');
    const sec = (await api('/api/admin/security')).data;
    assert.equal(sec.settings.requireTwoStep, true);
    assert.ok(sec.twoStep.staff.find(x => x.id === s.id).deadline);
    // After the 7 days: only My account until it is on.
    localSql(`UPDATE admin_users SET twostep_grace_until = ${Date.now() - 1000} WHERE id = '${s.id}'`);
    const blocked = await api('/api/admin/fans', 'GET', null, as(l));
    assert.equal(blocked.status, 403); assert.equal(blocked.data.restrict, 'twostep');
    assert.match((await fetch(`${BASE}/admin/inbox/`, { headers: as(l), redirect: 'manual' })).headers.get('location'), /must=twostep/);
    const start = (await api('/api/admin/account', 'POST', { action: 'start_2fa' }, as(l))).data;
    assert.equal((await api('/api/admin/account', 'POST', { action: 'confirm_2fa', otp: await codeAt(start.secret) }, as(l))).status, 200);
    assert.equal((await api('/api/admin/fans', 'GET', null, as(l))).status, 200, 'set up: everything works again');
    const off = await api('/api/admin/account', 'POST', { action: 'disable_2fa', password: PW, otp: await codeAt(start.secret, 1) }, as(l));
    assert.equal(off.status, 403, 'cannot be turned off while required');
  } finally {
    assert.equal((await api('/api/admin/security', 'POST', { action: 'require_two_step', on: false })).status, 200);
  }
});

test('IP allowlist: refuses to lock out the person saving it; other networks refused; the owner code always works', async () => {
  const sa = await staff('super_admin');
  const office = '10.77.0.5';
  const mine = await login({ email: sa.email, password: PW }, office);
  const elsewhere = '10.88.1.2';
  const self = await api('/api/admin/security', 'POST', { action: 'ip_allowlist', scope: 'super_admin', list: elsewhere }, as(mine));
  assert.equal(self.status, 400); assert.match(self.data.error, /sign you out/);
  assert.equal((await api('/api/admin/security', 'POST', { action: 'ip_allowlist', scope: 'all', list: 'not-an-ip' }, as(mine))).status, 400);
  try {
    assert.equal((await api('/api/admin/security', 'POST', { action: 'ip_allowlist', scope: 'super_admin', list: '10.77.0.0/16' }, as(mine))).status, 200);
    assert.equal((await api('/api/admin/me', 'GET', null, as(mine))).status, 200, 'office network still works');
    const away = await login({ email: sa.email, password: PW }, elsewhere);
    assert.equal(away.status, 403); assert.match(away.data.error, /network/);
    assert.equal((await api('/api/admin/me', 'GET', null, { ...as(mine), 'CF-Connecting-IP': elsewhere })).status, 401, 'a session taken elsewhere stops working');
    const other = await staff('fan_support');
    assert.equal((await login({ email: other.email, password: PW }, elsewhere)).status, 200, 'only Super Admins are limited');
    const owner = await login({ code: process.env.ADMIN_CODE || 'test-code-123' }, elsewhere);
    assert.equal(owner.status, 200, 'the owner code is the way back in');
  } finally {
    assert.equal((await api('/api/admin/security', 'POST', { action: 'ip_allowlist', scope: 'off', list: '' })).status, 200);
  }
});

test('the owner code signs in with a session (logged); requests from other websites are refused; strict headers on admin pages', async () => {
  const o = await login({ code: process.env.ADMIN_CODE || 'test-code-123' });
  assert.equal(o.status, 200);
  assert.match(o.cookie, /^ls_admin=v2\./);
  assert.equal((await api('/api/admin/me', 'GET', null, as(o))).data.admin.roleId, 'super_admin');
  assert.ok((await api('/api/admin/security')).data.events.some(e => e.action === 'owner_code_login'));
  // Another website trying to make a change with someone's cookie.
  const csrf = await api('/api/admin/account', 'POST', { action: 'logout_all' }, as(o, { Origin: 'https://evil.example' }));
  assert.equal(csrf.status, 403);
  assert.equal((await api('/api/admin/me', 'GET', null, as(o))).status, 200, 'still signed in');
  assert.equal((await api('/api/admin/me', 'POST', {}, as(o, { Origin: BASE }))).status, 200, 'own pages are fine');
  const page = await fetch(`${BASE}/admin/dashboard/`, { headers: as(o) });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(page.headers.get('content-security-policy'), /object-src 'none'/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.match((await fetch(`${BASE}/admin/login/`)).headers.get('content-security-policy') || '', /challenges\.cloudflare\.com/);
  // The owner can sign out every admin-code session.
  assert.equal((await api('/api/admin/account', 'POST', { action: 'logout_all' }, as(o))).status, 200);
  assert.equal((await api('/api/admin/me', 'GET', null, as(o))).status, 401);
});
