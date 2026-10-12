// Website Health: public /api/health, the cron-only health check (secret,
// at most every 5 minutes), "Check now", summary data, roles.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123 and CRON_SECRET=cron-test-secret.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const CRON = process.env.CRON_SECRET || 'cron-test-secret';
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;

test('public health endpoint', async () => {
  const r = await fetch(`${BASE}/api/health`);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.ok, true);
  assert.deepEqual(Object.keys(d).sort(), ['ok', 'time']);
});

test('check now, cron secret and 5-minute throttle, summary', async () => {
  const now = await fetch(`${BASE}/api/admin/health`, { method: 'POST', headers: ADMIN }).then(r => r.json());
  assert.equal(now.ok, true);
  const byKey = Object.fromEntries(now.checks.map(c => [c.key, c]));
  for (const k of ['home', 'tickets', 'programme', 'fixtures_api', 'database']) {
    assert.equal(byKey[k].ok, true, `${k}: ${byKey[k].error}`);
    assert.ok(byKey[k].uptime24h > 0);
  }
  assert.ok(now.lastRun);
  assert.equal((await fetch(`${BASE}/api/internal/health-check`, { method: 'POST' })).status, 403);
  const cron = await fetch(`${BASE}/api/internal/health-check`, { method: 'POST', headers: { Authorization: `Bearer ${CRON}` } }).then(r => r.json());
  assert.equal(cron.ok, true);
  assert.equal(cron.ran, false, 'a check ran less than 5 minutes ago');
  const page = await fetch(`${BASE}/admin/health/`, { headers: ADMIN, redirect: 'manual' });
  assert.equal(page.status, 200);
});

test('roles: Website Health is for Super Admins', async () => {
  const email = `wh-${uid()}@example.com`;
  await fetch(`${BASE}/api/admin/staff`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ name: 'WH Media', email, password: 'Role-Test-2026!', role: 'media' }) });
  const l = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
  const cookie = l.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${BASE}/api/admin/health`, { headers: { Cookie: cookie } })).status, 403);
});
