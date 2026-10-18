// The three Super Admins (SUPER_ADMIN_EMAILS server setting): accounts made from
// the list and invited (own password, two-step login before anything else),
// emails matched ignoring capitals, no fourth Super Admin, listed Super Admins
// can't be demoted, anyone else with the role is treated as Head of Media, the
// Gmail notice, and switching off the old emergency admin code (only once two
// Super Admins sign in with two-step login).
// Needs the local Pages dev server with ADMIN_CODE=test-code-123, FANS_DEV_LINKS=1,
// STAFF_TEST_PASSWORDS=1, PASSWORD_BREACH_CHECK=off and
// SUPER_ADMIN_EMAILS=Owner.One@Example.com,owner2@example.com,lobi.test.owner3@gmail.com. Edits the LOCAL D1.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { totpCode } from '../functions/api/_lib/totp.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const CODE = process.env.ADMIN_CODE || 'test-code-123';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': CODE };
const LIST = ['owner.one@example.com', 'owner2@example.com', 'lobi.test.owner3@gmail.com'];
const PW = 'Super-Admin-Test-2026';
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const localSql = sql => execSync(`npx wrangler d1 execute lobi-stars-tickets --local --command "${sql.replace(/"/g, '\\"')}"`, { stdio: 'pipe' });
const api = (path, method = 'GET', body, headers = ADMIN) => fetch(BASE + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
  .then(async r => ({ status: r.status, headers: r.headers, data: await r.json().catch(() => ({})) }));
const sessionOf = r => ((r.headers.getSetCookie?.() || []).find(c => c.startsWith('ls_admin=')) || '').split(';')[0];
const step = (k = 0) => Math.floor(Date.now() / 30000) + k;
async function login(body) {
  const r = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})), cookie: sessionOf(r) };
}
const as = cookie => ({ Cookie: cookie });
const ids = [];
after(async () => {
  await api('/api/admin/security', 'POST', { action: 'email_domain_only', on: false });
  for (const id of ids) await api(`/api/admin/staff/${id}`, 'PUT', { active: false, reason: 'test finished' });
});

const sa = {}; // email -> { cookie, secret, codes }
test('accounts are made from the list and invited; capitals ignored; two-step login comes before anything else', async () => {
  // A clean start for the three test Super Admins (local test database only).
  localSql(`DELETE FROM admin_sessions WHERE user_id IN (SELECT id FROM admin_users WHERE email IN ('${LIST.join("','")}'))`);
  localSql(`DELETE FROM admin_users WHERE email IN ('${LIST.join("','")}')`);
  const staff = (await api('/api/admin/staff')).data;
  assert.deepEqual(staff.superAdminEmails, LIST, 'trimmed, lower-case');
  for (const e of LIST) assert.equal(staff.staff.find(s => s.email === e)?.status, 'pending', `${e} made from the list`);
  const inv = await api('/api/admin/staff', 'POST', { action: 'invite_super_admins' });
  assert.equal(inv.status, 200);
  assert.deepEqual(inv.data.invited.map(i => i.email).sort(), [...LIST].sort());
  assert.equal((await api('/api/admin/staff', 'POST', { action: 'invite_super_admins' })).data.invited.length, 0, 'invited once');
  for (const { email, url } of inv.data.invited.filter(i => i.email !== LIST[0])) {
    const t = new URL(url).searchParams.get('t');
    const ok = await api('/api/admin/invite', 'POST', { t, password: PW }, {});
    assert.equal(ok.status, 200);
    const cookie = sessionOf(ok);
    const blocked = await api('/api/admin/staff', 'GET', null, as(cookie));
    assert.equal(blocked.status, 403); assert.equal(blocked.data.restrict, 'twostep', 'no grace period for Super Admins');
    const start = await api('/api/admin/account', 'POST', { action: 'start_2fa' }, as(cookie));
    const secret = start.data.secret.replace(/\s/g, '');
    const on = await api('/api/admin/account', 'POST', { action: 'confirm_2fa', otp: await totpCode(secret, step()) }, as(cookie));
    assert.equal(on.status, 200);
    sa[email] = { cookie, secret, codes: on.data.backupCodes };
    assert.equal((await api('/api/admin/staff', 'GET', null, as(cookie))).status, 200, 'full Super Admin');
    assert.equal((await api('/api/admin/security', 'GET', null, as(cookie))).status, 200);
  }
  // Mixed capitals are the same person.
  const mixed = await login({ email: 'OWNER2@Example.COM', password: PW, otp: sa['owner2@example.com'].codes[0] });
  assert.equal(mixed.status, 200, JSON.stringify(mixed.data));
  assert.equal((await api('/api/admin/me', 'GET', null, as(mixed.cookie))).data.admin.roleId, 'super_admin');
  sa['owner2@example.com'].cookie = mixed.cookie;
});

test('no fourth Super Admin; listed Super Admins stay; the @lobistarsfc.com rule exempts only the list', async () => {
  const outsider = `fourth-${uid()}@example.com`;
  const r = await api('/api/admin/staff', 'POST', { name: 'Fourth Person', email: outsider, role: 'super_admin' });
  assert.equal(r.status, 400); assert.match(r.data.error, /Super Admin list/);
  const other = await api('/api/admin/staff', 'POST', { name: 'Other Staff', email: `other-${uid()}@example.com`, role: 'fan_support', password: 'Role-Test-2026!' });
  ids.push(other.data.id);
  localSql(`UPDATE admin_users SET test_account = 0 WHERE id = '${other.data.id}'`);
  assert.equal((await api(`/api/admin/staff/${other.data.id}`, 'PUT', { role: 'super_admin' })).status, 400, 'cannot be promoted');
  const listed = (await api('/api/admin/staff')).data.staff.find(s => s.email === 'owner2@example.com');
  const demote = await api(`/api/admin/staff/${listed.id}`, 'PUT', { role: 'fan_support' }, as(sa['lobi.test.owner3@gmail.com'].cookie));
  assert.equal(demote.status, 400); assert.match(demote.data.error, /SUPER_ADMIN_EMAILS/);
  assert.equal((await api('/api/admin/security', 'POST', { action: 'email_domain_only', on: true })).status, 200);
  try {
    const d = await api('/api/admin/staff', 'POST', { name: 'Not Club', email: `x-${uid()}@gmail.com`, role: 'fan_support' });
    assert.equal(d.status, 400); assert.match(d.data.error, /lobistarsfc\.com/);
    const e = await api('/api/admin/staff', 'POST', { name: 'Listed', email: 'lobi.test.owner3@gmail.com', role: 'super_admin' });
    assert.equal(e.status, 409, 'not refused for the domain (the account already exists)');
  } finally {
    await api('/api/admin/security', 'POST', { action: 'email_domain_only', on: false });
  }
});

test('anyone else holding the Super Admin role is treated as (and moved to) Head of Media', async () => {
  const email = `oldboss-${uid()}@lobistarsfc.com`;
  const p = await api('/api/admin/staff', 'POST', { name: 'Old Boss', email, role: 'fan_support', password: 'Role-Test-2026!' });
  ids.push(p.data.id);
  localSql(`UPDATE admin_users SET role = 'super_admin', test_account = 0 WHERE id = '${p.data.id}'`);
  const l = await login({ email, password: 'Role-Test-2026!' });
  // Before anything moves them, the role already gives only Head of Media rights.
  assert.equal((await api('/api/admin/staff', 'GET', null, as(l.cookie))).status, 403, 'not a Super Admin');
  // Opening the Staff page (or the every-minute job) moves them for good.
  const row = (await api('/api/admin/staff')).data.staff.find(s => s.id === p.data.id);
  assert.equal(row.role, 'head_of_media');
  assert.equal(l.status, 200);
  const me = (await api('/api/admin/me', 'GET', null, as(l.cookie))).data.admin;
  assert.equal(me.roleId, 'head_of_media');
  assert.ok(!me.permissions.includes('staff.manage') && me.permissions.includes('fans.inbox.read') && me.permissions.includes('commerce.tickets.manage'));
  assert.equal((await api('/api/admin/staff', 'GET', null, as(l.cookie))).status, 403);
  assert.equal((await api('/api/admin/security', 'GET', null, as(l.cookie))).status, 403);
  assert.equal((await api('/api/admin/activity', 'GET', null, as(l.cookie))).status, 403, 'no logs');
  assert.ok((await api('/api/admin/activity')).data.log.some(x => x.action === 'role_assigned' && /Super Admin -> Head of Media/.test(x.detail)));
});

test('the one-time Gmail notice for Super Admins on Gmail, with the acknowledgement recorded', async () => {
  const g = sa['lobi.test.owner3@gmail.com'];
  assert.equal((await api('/api/admin/me', 'GET', null, as(g.cookie))).data.admin.gmailNotice, true);
  assert.equal((await api('/api/admin/me', 'GET', null, as(sa['owner2@example.com'].cookie))).data.admin.gmailNotice, undefined, 'not for other addresses');
  assert.equal((await api('/api/admin/account', 'POST', { action: 'ack_gmail' }, as(g.cookie))).status, 200);
  assert.equal((await api('/api/admin/me', 'GET', null, as(g.cookie))).data.admin.gmailNotice, undefined);
  const sec = (await api('/api/admin/security')).data.superAdmins.list.find(p => p.email === 'lobi.test.owner3@gmail.com');
  assert.ok(sec.gmailNoticeAt);
});

test('security emails can go to only one chosen Super Admin (or all of them)', async () => {
  assert.equal((await api('/api/admin/security', 'POST', { action: 'alert_only', email: 'someone.else@example.com' })).status, 400, 'only a listed Super Admin');
  assert.equal((await api('/api/admin/security', 'POST', { action: 'alert_only', email: 'OWNER2@example.com' })).status, 200);
  assert.equal((await api('/api/admin/security')).data.settings.alertOnly, 'owner2@example.com');
  assert.ok((await api('/api/admin/activity?q=security alerts go to')).data.log.some(l => /owner2@example\.com/.test(l.detail)), 'logged');
  assert.equal((await api('/api/admin/security', 'POST', { action: 'alert_only', email: '' })).status, 200, 'back to every Super Admin');
  assert.equal((await api('/api/admin/security')).data.settings.alertOnly, '');
});

test('the old emergency admin code: only switched off once two Super Admins use two-step login; then refused and reported', async () => {
  const s2 = sa['owner2@example.com'], s3 = sa['lobi.test.owner3@gmail.com'];
  localSql(`UPDATE admin_users SET twostep_login_at = NULL WHERE email IN ('${LIST.join("','")}')`);
  const early = await api('/api/admin/security', 'POST', { action: 'admin_code', off: true }, as(s2.cookie));
  assert.equal(early.status, 409, 'not before two Super Admins have signed in with two-step login');
  // Both sign in with two-step login (that proves it works).
  const l2 = await login({ email: 'owner2@example.com', password: PW, otp: await totpCode(s2.secret, step(1)) });
  const l3 = await login({ email: 'lobi.test.owner3@gmail.com', password: PW, otp: await totpCode(s3.secret, step(1)) });
  assert.equal(l2.status, 200); assert.equal(l3.status, 200);
  try {
    assert.equal((await api('/api/admin/security', 'POST', { action: 'admin_code', off: true }, as(l2.cookie))).status, 200);
    const tryCode = await login({ code: CODE });
    assert.equal(tryCode.status, 403); assert.match(tryCode.data.error, /no longer used/);
    assert.equal((await api('/api/admin/me')).status, 401, 'the code in a header stops working too');
    const log = (await api('/api/admin/activity', 'GET', null, as(l3.cookie))).data.log;
    assert.ok(log.some(x => x.action === 'owner_code_refused'));
    assert.equal((await api('/api/admin/security', 'GET', null, as(l3.cookie))).data.superAdmins.adminCodeOff, true);
  } finally {
    assert.equal((await api('/api/admin/security', 'POST', { action: 'admin_code', off: false }, as(l3.cookie))).status, 200);
  }
  assert.equal((await login({ code: CODE })).status, 200, 'switched back on');
});
