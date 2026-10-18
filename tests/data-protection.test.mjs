// Data protection and backups: fans' emails and phones are masked in lists (full
// only on the fan's page, for roles that may see them); bulk downloads need
// download rights plus a fresh two-step code, and the file name has the date and
// initials; ticket orders count as fan data; automatic encrypted backups (no
// secrets inside); the Contractor role (end date, at most 14 days, no fan data,
// every sign-in reported).
// Needs the local Pages dev server with ADMIN_CODE=test-code-123, STAFF_TEST_PASSWORDS=1,
// PASSWORD_BREACH_CHECK=off, CRON_SECRET=cron-test-secret, BACKUP_KEY and --r2=BACKUP_BUCKET.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { totpCode } from '../functions/api/_lib/totp.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const CRON = { Authorization: `Bearer ${process.env.CRON_SECRET || 'cron-test-secret'}` };
const PW = 'Role-Test-2026!';
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const localSql = sql => execSync(`npx wrangler d1 execute lobi-stars-tickets --local --command "${sql.replace(/"/g, '\\"')}"`, { stdio: 'pipe' });
const api = (path, method = 'GET', body, headers = ADMIN) => fetch(BASE + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
  .then(async r => ({ status: r.status, headers: r.headers, data: await r.json().catch(() => ({})) }));
const made = [];
after(async () => { for (const id of made) await api(`/api/admin/staff/${id}`, 'PUT', { active: false, reason: 'test finished' }); });
async function staff(role, extra = {}) {
  const email = `dp-${role}-${uid()}@example.com`;
  const r = await api('/api/admin/staff', 'POST', { name: `Ada Obi ${uid()}`, email, role, password: PW, ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  made.push(r.data.id);
  const l = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ email, password: PW }) });
  return { id: r.data.id, email, status: l.status, h: { Cookie: ((l.headers.getSetCookie?.() || []).find(c => c.startsWith('ls_admin=')) || '').split(';')[0] } };
}

test('fan lists are masked (a***@gmail.com, 0803****21); the full details only on the fan\'s own page', async () => {
  const email = `masked.fan.${uid()}@gmail.com`;
  assert.equal((await api('/api/newsletter', 'POST', { fullName: 'Masked Fan', phone: `0803${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, email, confirmEmail: email, consent: true, source: 'test' }, { 'CF-Connecting-IP': randIp() })).status, 200);
  const row = (await api(`/api/admin/fans?q=${encodeURIComponent(email)}`)).data.rows[0];
  assert.equal(row.email, 'm***@gmail.com', 'masked in the list, even for a Super Admin');
  assert.match(row.phone, /^0803\*{4}\d{2}$/);
  const full = (await api(`/api/admin/fans/${row.id}`)).data;
  assert.equal(full.contact.email, email, 'full on the fan\'s page');
  const subs = (await api(`/api/admin/newsletter?subscribers=1&q=masked.fan`)).data.people;
  assert.ok(subs.every(p => /\*\*\*@/.test(p.email)), 'newsletter subscriber list masked');
});

test('downloads need download rights and a fresh two-step code; the file name has the date and initials', async () => {
  const fs = await staff('fan_support');
  assert.equal((await api('/api/admin/fans/export?type=xlsx', 'GET', null, fs.h)).status, 403, 'Fan Support: no download rights');
  const crm = await staff('crm_manager');
  const noTwoStep = await api('/api/admin/fans/export?type=xlsx', 'GET', null, crm.h);
  assert.equal(noTwoStep.status, 428); assert.equal(noTwoStep.data.twoStep, false, 'two-step login needed first');
  const start = await api('/api/admin/account', 'POST', { action: 'start_2fa' }, crm.h);
  const secret = start.data.secret.replace(/\s/g, '');
  assert.equal((await api('/api/admin/account', 'POST', { action: 'confirm_2fa', otp: await totpCode(secret, Math.floor(Date.now() / 30000)) }, crm.h)).status, 200);
  const ask = await api('/api/admin/fans/export?type=xlsx', 'GET', null, crm.h);
  assert.equal(ask.status, 428); assert.equal(ask.data.needCode, true);
  assert.equal((await api('/api/admin/export-ticket', 'POST', { otp: '000000' }, crm.h)).status, 400, 'a wrong code');
  const t = await api('/api/admin/export-ticket', 'POST', { otp: await totpCode(secret, Math.floor(Date.now() / 30000) + 1) }, crm.h);
  assert.equal(t.status, 200); assert.match(t.data.ticket, /^[a-f0-9]{48}$/);
  const dl = await fetch(`${BASE}/api/admin/fans/export?type=xlsx`, { headers: { ...crm.h, 'x-export-ticket': t.data.ticket } });
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /lobi-stars-contacts-\d{4}-\d{2}-\d{2}-AO[A-Z0-9]?\.xlsx/, 'date and initials (Ada Obi …)');
  await dl.arrayBuffer();
  // Someone else's pass doesn't work.
  const other = await staff('crm_manager');
  assert.equal((await fetch(`${BASE}/api/admin/fans/export?type=xlsx`, { headers: { ...other.h, 'x-export-ticket': t.data.ticket } })).status, 428);
  // Ticket orders contain buyers' details: download rights needed, and logged.
  const ops = await staff('matchday_ops_manager');
  assert.equal((await api('/api/admin/tickets/export.csv', 'GET', null, ops.h)).status, 403);
  const csv = await fetch(`${BASE}/api/admin/tickets/export.csv`, { headers: ADMIN });
  assert.equal(csv.status, 200); assert.match(csv.headers.get('content-disposition'), /ticket-orders-\d{4}-\d{2}-\d{2}-[A-Z]+\.csv/); await csv.text();
  assert.ok((await api('/api/admin/activity?q=ticket orders')).data.log.some(l => l.action === 'export_ticket_orders'));
});

test('automatic backups: encrypted, in steps, listed, and readable for restoring (no secrets inside)', async () => {
  const start = await api('/api/admin/backup', 'POST', { action: 'backup_now' });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  for (let i = 0; i < 40; i++) {
    const s = (await api('/api/admin/backup?auto=status')).data;
    if (!s.running) break;
    await api('/api/internal/backup-run', 'POST', {}, CRON);
  }
  const s = (await api('/api/admin/backup?auto=status')).data;
  assert.equal(s.ready, true); assert.equal(s.error, null); assert.ok(s.last && s.last.tables > 20, JSON.stringify(s.last));
  const day = s.last.day;
  assert.ok(s.backups.some(b => b.day === day && b.complete));
  const man = (await api(`/api/admin/backup?autoday=${day}`)).data;
  const users = man.parts.find(p => p.table === 'admin_users');
  const part = (await api(`/api/admin/backup?autopart=${encodeURIComponent(users.key)}`)).data;
  assert.equal(part.table, 'admin_users');
  assert.ok(part.columns.includes('email'));
  for (const c of part.columns) assert.doesNotMatch(c, /password|totp|secret|hash/i, c);
  assert.ok(!man.parts.some(p => ['admin_sessions', 'auth_tokens', 'export_tickets'].includes(p.table)), 'sign-in data left out');
  assert.equal((await api('/api/internal/backup-run', 'POST', {}, {})).status, 403);
  assert.ok((await api('/api/admin/activity?q=backup')).data.log.some(l => l.action === 'backup_auto'));
});

test('Contractor: an end date (at most 14 days), no fans\' data, every sign-in reported, nothing after the end date', async () => {
  const email = `contractor-${uid()}@example.com`;
  assert.equal((await api('/api/admin/staff', 'POST', { name: 'Dev Contractor', email, role: 'contractor', password: PW })).status, 400, 'needs an end date');
  const tooLong = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
  assert.equal((await api('/api/admin/staff', 'POST', { name: 'Dev Contractor', email, role: 'contractor', password: PW, accessUntil: tooLong })).status, 400, 'at most 14 days');
  const c = await staff('contractor', { accessUntil: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) });
  assert.equal(c.status, 200);
  const me = (await api('/api/admin/me', 'GET', null, c.h)).data.admin;
  assert.equal(me.roleId, 'contractor'); assert.ok(me.accessUntil);
  for (const p of ['/api/admin/fans', '/api/admin/inbox', '/api/admin/rewards', '/api/admin/activity', '/api/admin/staff']) assert.equal((await api(p, 'GET', null, c.h)).status, 403, p);
  assert.equal((await api('/api/admin/awards', 'GET', null, c.h)).status, 200, 'content is fine');
  const bell = (await api('/api/admin/notifications')).data.items.map(i => i.title);
  assert.ok(bell.some(t => /Contractor .* signed in/.test(t)), 'reported to the Super Admins');
  const roles = (await api('/api/admin/roles')).data.roles;
  assert.equal((await api('/api/admin/roles', 'PUT', { id: 'contractor', permissions: [...roles.find(r => r.id === 'contractor').permissions, 'fans.database.view'] })).status, 400, 'never fans\' data');
  localSql(`UPDATE admin_users SET access_until = ${Date.now() - 1000} WHERE id = '${c.id}'`);
  assert.equal((await api('/api/admin/me', 'GET', null, c.h)).status, 401, 'access ended');
  const again = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ email: c.email, password: PW }) });
  assert.equal(again.status, 403); assert.match((await again.json()).error, /temporary access has ended/);
});
