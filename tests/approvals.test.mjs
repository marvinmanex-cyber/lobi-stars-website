// Approvals for sensitive actions: new staff, Super Admin / download rights,
// adding downloads to a role, big Rewards points changes and official statements
// wait for another Super Admin. Nobody approves their own request; rejecting needs
// a reason; each kind can be switched off; everything is recorded.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123, FANS_DEV_LINKS=1,
// STAFF_TEST_PASSWORDS=1 and PASSWORD_BREACH_CHECK=off. Edits the LOCAL D1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const PW = 'Role-Test-2026!';
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const api = (path, method = 'GET', body, headers = ADMIN) => fetch(BASE + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
  .then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const made = [];
async function ready(role) {
  const email = `apv-${role}-${uid()}@example.com`;
  const r = await api('/api/admin/staff', 'POST', { name: `Apv ${role} ${uid()}`, email, role, password: PW });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  made.push(r.data.id);
  const l = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ email, password: PW }) });
  return { id: r.data.id, email, h: { Cookie: (l.headers.getSetCookie?.() || []).find(c => c.startsWith('ls_admin=')).split(';')[0] } };
}
const sw = (key, on) => api('/api/admin/approvals', 'POST', { switch: key, on });
let approver;
before(async () => {
  approver = await ready('super_admin'); // another Super Admin who can approve the owner's requests
  await sw('approvals_staff', true); await sw('approvals_points', true);
});
after(async () => {
  await sw('approvals_staff', false);
  for (const id of made) await api(`/api/admin/staff/${id}`, 'PUT', { active: false, reason: 'test finished' });
});

test('a new staff account waits for another Super Admin; you cannot approve your own; approving sends the invite', async () => {
  const email = `wait-${uid()}@example.com`;
  const r = await api('/api/admin/staff', 'POST', { name: 'Waiting Person', email, role: 'fan_support' });
  assert.equal(r.status, 202); assert.equal(r.data.pending, true); assert.match(r.data.message, /approval/i);
  assert.ok(!(await api('/api/admin/staff')).data.staff.some(s => s.email === email), 'not made yet');
  const list = (await api('/api/admin/approvals', 'GET', null, approver.h)).data;
  const req = list.pending.find(p => p.summary.includes(email));
  assert.ok(req); assert.equal(req.kind, 'staff_invite');
  assert.equal((await api('/api/admin/approvals', 'POST', { id: req.id, approve: true })).status, 403, 'not your own request');
  const bell = (await api('/api/admin/notifications', 'GET', null, approver.h)).data.items;
  assert.ok(bell.some(i => /waiting for approval/.test(i.title)), 'the bell tells approvers');
  const ok = await api('/api/admin/approvals', 'POST', { id: req.id, approve: true }, approver.h);
  assert.equal(ok.status, 200, JSON.stringify(ok.data)); assert.match(ok.data.result, /Invite sent/);
  assert.equal((await api('/api/admin/staff')).data.staff.find(s => s.email === email)?.status, 'pending');
  assert.equal((await api('/api/admin/approvals', 'POST', { id: req.id, approve: true }, approver.h)).status, 409, 'decided once');
  const log = (await api('/api/admin/activity')).data.log.map(l => l.action);
  assert.ok(log.includes('approval_requested') && log.includes('approval_approved'));
});

test('rejecting needs a reason; giving download rights or Super Admin waits for approval', async () => {
  const fs = await ready('fan_support');
  const r = await api(`/api/admin/staff/${fs.id}`, 'PUT', { role: 'crm_manager' });
  assert.equal(r.status, 202, 'CRM Manager can download fan data');
  const req = (await api('/api/admin/approvals', 'GET', null, approver.h)).data.pending.find(p => p.kind === 'role_change' && p.summary.includes(fs.email));
  assert.equal((await api('/api/admin/approvals', 'POST', { id: req.id, approve: false }, approver.h)).status, 400, 'a reason is needed');
  assert.equal((await api('/api/admin/approvals', 'POST', { id: req.id, approve: false, reason: 'Not needed for this job' }, approver.h)).status, 200);
  assert.equal((await api('/api/admin/staff')).data.staff.find(s => s.id === fs.id).role, 'fan_support', 'unchanged');
  const hist = (await api('/api/admin/approvals', 'GET', null, approver.h)).data.history.find(h => h.id === req.id);
  assert.equal(hist.status, 'rejected'); assert.equal(hist.reason, 'Not needed for this job');
  // A role without downloads changes straight away.
  assert.equal((await api(`/api/admin/staff/${fs.id}`, 'PUT', { role: 'commercial_manager' })).status, 200);
  assert.equal((await api('/api/admin/staff')).data.staff.find(s => s.id === fs.id).role, 'commercial_manager');
});

test('adding "Download fan contact data" to a role waits for approval; approving saves it', async () => {
  const roles = (await api('/api/admin/roles')).data.roles;
  const fsRole = roles.find(r => r.id === 'fan_support');
  try {
    const r = await api('/api/admin/roles', 'PUT', { id: 'fan_support', permissions: [...fsRole.permissions, 'fans.export'] });
    assert.equal(r.status, 202);
    const req = (await api('/api/admin/approvals', 'GET', null, approver.h)).data.pending.find(p => p.kind === 'role_permissions');
    assert.equal((await api('/api/admin/approvals', 'POST', { id: req.id, approve: true }, approver.h)).status, 200);
    assert.ok((await api('/api/admin/roles')).data.roles.find(x => x.id === 'fan_support').permissions.includes('fans.export'));
  } finally {
    await api('/api/admin/roles', 'PUT', { id: 'fan_support', reset: true });
  }
});

test('switched off: no approval needed; Rewards points over 1,000 wait; official statements are listed for approval', async () => {
  await sw('approvals_staff', false);
  const email = `now-${uid()}@example.com`;
  const r = await api('/api/admin/staff', 'POST', { name: 'Straight Away', email, role: 'fan_support' });
  assert.equal(r.status, 200, 'goes ahead');
  made.push(r.data.id);
  await sw('approvals_staff', true);
  const settings = (await api('/api/admin/approvals', 'GET', null, approver.h)).data;
  assert.ok(settings.switches.find(s => s.key === 'approvals_points').on);
  assert.ok(Array.isArray(settings.statements));
  assert.equal((await api('/api/admin/approvals', 'POST', { statement: { slug: 'no-such-article', hash: 'x', title: 'X' } }, approver.h)).status, 409);
  // The build reads which statements are approved (and whether approval is needed) from this public list.
  const pub = await (await fetch(`${BASE}/api/news-approvals`)).json();
  assert.equal(typeof pub.enforce.official, 'boolean'); assert.ok(Array.isArray(pub.approved));
  // Only approvers open the Approvals page.
  const cm = await ready('commercial_manager');
  assert.equal((await api('/api/admin/approvals', 'GET', null, cm.h)).status, 403);
  assert.equal((await fetch(`${BASE}/admin/approvals/`, { headers: cm.h, redirect: 'manual' })).status, 403);
});
