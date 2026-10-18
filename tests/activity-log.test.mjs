// The Activity Log and alerts: filters (person, type, dates), device and rough
// location per entry (network address for Super Admins only), entries can't be
// changed or deleted, fan-data downloads and many failed sign-ins become alerts
// (emailed by the security job and shown in the bell), the weekly summary.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123, STAFF_TEST_PASSWORDS=1,
// PASSWORD_BREACH_CHECK=off, CRON_SECRET=cron-test-secret. Edits the LOCAL D1.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const CRON = { Authorization: `Bearer ${process.env.CRON_SECRET || 'cron-test-secret'}` };
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const api = (path, method = 'GET', body, headers = ADMIN) => fetch(BASE + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
  .then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const sqlFails = sql => { try { execSync(`npx wrangler d1 execute lobi-stars-tickets --local --command "${sql}"`, { stdio: 'pipe' }); return false; } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); } };
const made = [];
after(async () => {
  await api('/api/admin/roles', 'PUT', { id: 'fan_support', reset: true });
  for (const id of made) await api(`/api/admin/staff/${id}`, 'PUT', { active: false, reason: 'test finished' });
});

let person;
test('each entry says who, what, when and from where (device, rough location); filters by person, type and date', async () => {
  const email = `log-${uid()}@example.com`;
  const r = await api('/api/admin/staff', 'POST', { name: `Log Person ${uid()}`, email, role: 'fan_support', password: 'Role-Test-2026!' });
  made.push(r.data.id); person = r.data.id;
  const l = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.42.0.7', 'CF-IPCountry': 'NG', 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile' }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
  const cookie = (l.headers.getSetCookie?.() || []).find(c => c.startsWith('ls_admin=')).split(';')[0];
  await api('/api/admin/members', 'POST', { action: 'confirm', id: 'no-such-member' }, { Cookie: cookie, 'CF-Connecting-IP': '10.42.0.7' });
  const today = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
  const d = (await api(`/api/admin/activity?person=${person}&from=${today}&to=${today}`)).data;
  const login = d.log.find(x => x.action === 'login');
  assert.ok(login, 'their sign-in is listed');
  assert.ok(d.log.every(x => x.staff_id === person), 'only that person');
  assert.equal(login.device, 'Chrome on Android'); assert.equal(login.location, 'NG');
  assert.equal(login.ip, '10.42.0.7', 'the network address for Super Admins');
  assert.equal(login.category, 'security');
  const sec = (await api(`/api/admin/activity?person=${person}&category=security`)).data.log;
  assert.ok(sec.length && sec.every(x => x.category === 'security'));
  assert.ok(d.categories.exports && d.people.some(p => p.staff_id === person));
  assert.equal((await api(`/api/admin/activity?person=${person}&from=2020-01-01&to=2020-01-02`)).data.log.length, 0, 'date filter');
  // Someone else allowed to read the log doesn't see network addresses.
  const roles = (await api('/api/admin/roles')).data.roles;
  await api('/api/admin/roles', 'PUT', { id: 'fan_support', permissions: [...roles.find(x => x.id === 'fan_support').permissions, 'logs.view'] });
  const other = (await api(`/api/admin/activity?person=${person}`, 'GET', null, { Cookie: cookie })).data;
  assert.equal(other.showIp, false); assert.ok(other.log.every(x => x.ip === undefined));
  await api('/api/admin/roles', 'PUT', { id: 'fan_support', reset: true });
});

test('entries cannot be changed or deleted, not even directly in the database', async () => {
  const upd = sqlFails(`UPDATE admin_log SET detail = 'changed' WHERE id = (SELECT MAX(id) FROM admin_log)`);
  assert.ok(upd && /cannot be changed/i.test(upd), 'update refused');
  const del = sqlFails(`DELETE FROM admin_log WHERE id = (SELECT MAX(id) FROM admin_log)`);
  assert.ok(del && /12 months/i.test(del), 'delete refused');
});

test('downloading fan data and many failed sign-ins are alerts: in the bell, emailed by the security job', async () => {
  const x = await fetch(`${BASE}/api/admin/fans/export?type=xlsx`, { headers: ADMIN });
  assert.equal(x.status, 200); await x.arrayBuffer();
  // The burst alert is sent at most once an hour: clear any from earlier test files first.
  sqlFails(`DELETE FROM admin_alerts WHERE kind = 'failed_burst'`);
  for (let i = 0; i < 12; i++) await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ email: `nobody-${uid()}@example.com`, password: 'Wrong-Password-99' }) });
  const bell = (await api('/api/admin/notifications')).data.items.map(i => i.title);
  assert.ok(bell.some(t => /Fan data downloaded/.test(t)), 'download alert in the bell');
  assert.ok(bell.some(t => /failed sign-ins in 10 minutes/.test(t)), 'failed sign-in burst alert');
  const job = await api('/api/internal/super-admins', 'POST', {}, CRON);
  assert.equal(job.status, 200); assert.equal(typeof job.data.alertsSent, 'number');
  // The Export Log lists the download with the number of rows.
  const ex = (await api('/api/admin/export-log')).data.log.find(l => l.action === 'export_xlsx');
  assert.match(ex.detail, /\d+ rows/);
});

test('the weekly security summary is sent (Mondays from 08:00, or on request) and recorded', async () => {
  const r = await api('/api/internal/super-admins?weekly=now', 'POST', {}, CRON);
  assert.equal(r.data.weekly, true);
  assert.ok((await api('/api/admin/activity?q=security summary')).data.log.some(l => l.action === 'security_summary_sent'));
});
