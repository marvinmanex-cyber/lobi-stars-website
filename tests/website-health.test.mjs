// Website Health: only the three Super Admins can open it (every other role gets
// 403 from the page and the API); checks run in steps, one run at a time; results
// have plain-English problems, fix steps and who fixes it; acknowledge, history,
// safe fixes (logged); the timer job endpoint; /health/ping; no secret in a report.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123, STAFF_TEST_PASSWORDS=1,
// PASSWORD_BREACH_CHECK=off and CRON_SECRET=cron-test-secret.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const CODE = process.env.ADMIN_CODE || 'test-code-123';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': CODE };
const CRON_SECRET = process.env.CRON_SECRET || 'cron-test-secret';
const PW = 'Role-Test-2026!';
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const api = (path, method = 'GET', body, headers = ADMIN) => fetch(BASE + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
  .then(async r => ({ status: r.status, text: await r.clone().text(), data: await r.json().catch(() => ({})) }));
const made = [];
after(async () => { for (const id of made) await api(`/api/admin/staff/${id}`, 'PUT', { active: false, reason: 'test finished' }); });
async function staff(role, extra = {}) {
  const email = `wh-${role}-${uid()}@example.com`;
  const r = await api('/api/admin/staff', 'POST', { name: `Health ${role} ${uid()}`, email, role, password: PW, ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  made.push(r.data.id);
  const l = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ email, password: PW }) });
  return { Cookie: ((l.headers.getSetCookie?.() || []).find(c => c.startsWith('ls_admin=')) || '').split(';')[0] };
}
async function runToEnd(body) {
  const s = await api('/api/admin/health', 'POST', { action: 'start', ...body });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  let run = s.data.run;
  for (let i = 0; i < 200 && !run.done; i++) {
    const r = await api('/api/admin/health', 'POST', { action: 'step', id: run.id });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    run = r.data.run;
    if (r.data.busy) await new Promise(x => setTimeout(x, 1000));
  }
  return run;
}

test('only the Super Admins: every other role gets 403 from the API and the page; the permission can\'t be given to another role', async () => {
  assert.equal((await api('/api/admin/health')).status, 200);
  for (const role of ['head_of_media', 'crm_manager', 'content_editor', 'matchday_ops_manager']) {
    const h = await staff(role);
    assert.equal((await api('/api/admin/health', 'GET', null, h)).status, 403, `${role}: API`);
    assert.equal((await api('/api/admin/health', 'POST', { action: 'start', kind: 'full' }, h)).status, 403, `${role}: start`);
    assert.equal((await fetch(`${BASE}/admin/health/`, { headers: h, redirect: 'manual' })).status !== 200, true, `${role}: page`);
  }
  const roles = (await api('/api/admin/roles')).data.roles;
  const cm = roles.find(r => r.id === 'commercial_manager');
  assert.equal((await api('/api/admin/roles', 'PUT', { id: 'commercial_manager', permissions: [...cm.permissions, 'website.health'] })).status, 400);
  assert.ok(!roles.find(r => r.id === 'head_of_media').permissions.includes('website.health'), 'Head of Media has no Website Health');
});

test('a category check runs in steps and each result explains the problem, the fix and who fixes it; no secret appears', async () => {
  const run = await runToEnd({ kind: 'category', only: 'security' });
  assert.equal(run.done, true); assert.ok(run.totals.checks >= 10, JSON.stringify(run.totals));
  const o = await api('/api/admin/health');
  const sec = o.data.checks.filter(c => c.category === 'security');
  for (const c of sec) {
    assert.ok(['PASS', 'WARNING', 'FAIL', 'SKIPPED'].includes(c.status), c.id);
    assert.ok(c.name && c.problem && c.who && c.checkedAt, c.id);
    if (c.status === 'WARNING' || c.status === 'FAIL') assert.ok(c.fix.length && c.why, `${c.id} has fix steps`);
  }
  assert.ok(sec.some(c => c.id === 'admin_login' && c.status === 'PASS'), 'the admin needs a login');
  assert.ok(sec.some(c => c.id === 'private_files' && c.status === 'PASS'));
  assert.ok(o.data.categories.length === 9 && o.data.problems);
  for (const secret of [CODE, CRON_SECRET]) assert.ok(!o.text.includes(secret), 'no secret value in the report');
  const brief = await api('/api/admin/health?brief=1');
  assert.ok(['PASS', 'WARNING', 'FAIL'].includes(brief.data.status)); assert.equal(typeof brief.data.fail, 'number');
});

test('payments, email, matchday and tasks checks run; fan forms are tested without saving anything', async () => {
  for (const only of ['payments', 'fans']) await runToEnd({ kind: 'category', only });
  const o = (await api('/api/admin/health')).data;
  const ids = o.checks.map(c => c.id);
  for (const id of ['paystack_keys', 'paystack_webhook', 'food_expiry', 'fan_pages', 'fan_endpoints', 'turnstile']) assert.ok(ids.includes(id), id);
  assert.equal(o.checks.find(c => c.id === 'fan_endpoints').status, 'PASS', 'forms answer with "please fill in", never an error');
});

test('one run at a time; acknowledge; history; safe fixes are logged; test email; report logged', async () => {
  const a = await api('/api/admin/health', 'POST', { action: 'start', kind: 'category', only: 'outside' });
  const b = await api('/api/admin/health', 'POST', { action: 'start', kind: 'category', only: 'tasks' });
  assert.equal(b.data.already, true); assert.equal(b.data.run.id, a.data.run.id, 'never two at once');
  for (let i = 0; i < 20; i++) { const r = await api('/api/admin/health', 'POST', { action: 'step', id: a.data.run.id }); if (r.data.run.done) break; }
  await runToEnd({ kind: 'category', only: 'tasks' });
  const o = (await api('/api/admin/health')).data;
  const warn = o.checks.find(c => c.status === 'WARNING' || c.status === 'FAIL');
  assert.ok(warn, 'the test server always has something to fix');
  assert.equal((await api('/api/admin/health', 'POST', { action: 'ack', checkId: warn.id, note: 'Known, waiting for the club' })).status, 200);
  assert.ok((await api('/api/admin/health')).data.checks.find(c => c.id === warn.id).ack.note.includes('Known'));
  const h = await api(`/api/admin/health?history=${warn.id}`);
  assert.equal(h.status, 200); assert.ok(h.data.changes.length >= 1);
  assert.equal((await api('/api/admin/health', 'POST', { action: 'fix', fixId: 'delete_everything' })).status, 400, 'only the listed safe fixes');
  assert.equal((await api('/api/admin/health', 'POST', { action: 'fix', fixId: 'mark_restore_tested', checkId: 'restore_test' })).status, 200);
  const log = (await api('/api/admin/activity?q=Website Health')).data.log.map(l => l.action);
  for (const a2 of ['health_check', 'health_fix', 'health_ack']) assert.ok(log.includes(a2), a2);
  const t = await api('/api/admin/health', 'POST', { action: 'test_email' });
  assert.ok([200, 400].includes(t.status)); // 400 where email isn't set up (local test server)
  assert.equal((await api('/api/admin/health', 'POST', { action: 'report' })).status, 200);
});

test('the timer job endpoint needs its secret and drives the automatic checks; /health/ping says only "ok"', async () => {
  assert.equal((await api('/api/internal/health-check', 'POST', {}, {})).status, 403);
  const r = await api('/api/internal/health-check', 'POST', {}, { Authorization: `Bearer ${CRON_SECRET}` });
  assert.equal(r.status, 200); assert.equal(typeof r.data.more, 'boolean');
  const p = await fetch(`${BASE}/health/ping`);
  assert.equal(p.status, 200); assert.equal(await p.text(), 'ok');
});
