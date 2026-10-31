// Media Centre, phase 1: users, sign-in (Login ID + password), temporary
// passwords, lockout, idle sign-out, CSRF, no access to the admin, the
// append-only activity log and the Approval Queue.
// Run against a local server: BASE=http://127.0.0.1:8844 node --test tests/media-centre.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './media-helpers.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 8);
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const T = uid().replace(/\d/g, 'q');
const LOGIN = `Tester${T}${String(Math.floor(Math.random() * 90) + 10)}`;
const admin = (p, body) => fetch(`${BASE}/api/admin/media-centre/${p}`, body ? { method: 'POST', headers: ADMIN, body: JSON.stringify(body) } : { headers: ADMIN }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})), r }));
async function login(loginId, password, from = ip()) {
  const r = await fetch(`${BASE}/api/media-centre/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': from }, body: JSON.stringify({ loginId, password }) });
  const d = await r.json().catch(() => ({}));
  const cookie = (r.headers.get('set-cookie') || '').match(/ls_media=[^;]+/)?.[0] || null;
  return { status: r.status, data: d, cookie };
}
const mc = (s, p, method = 'GET', body, extra = {}) => fetch(`${BASE}/api/media-centre/${p}`, { method, headers: { Cookie: s.cookie, 'X-CSRF-Token': s.data.csrf, 'Content-Type': 'application/json', ...extra }, body: body ? JSON.stringify(body) : undefined })
  .then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
let userId;

after(() => { sql(`DELETE FROM mc_sessions WHERE user_id IN (SELECT id FROM mc_users WHERE login_key LIKE 'tester${T}%'); DELETE FROM mc_users WHERE login_key LIKE 'tester${T}%';`); });

test('a Super Admin creates a user; the Login ID format is checked', async () => {
  assert.equal((await admin('users', { action: 'create', loginId: 'terver.iorbee', fullName: 'Terver Iorbee', password: 'Temp-pass-1' })).status, 400);
  assert.equal((await admin('users', { action: 'create', loginId: 'Iorbee1', fullName: 'Terver Iorbee', password: 'Temp-pass-1' })).status, 400, 'at least 2 digits');
  assert.equal((await admin('users', { action: 'create', loginId: LOGIN, fullName: 'Terver Tester', password: 'short' })).status, 400, 'password at least 8');
  const r = await admin('users', { action: 'create', loginId: LOGIN, fullName: 'Terver Tester', password: 'Temp-pass-123' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  userId = r.data.id;
  assert.equal((await admin('users', { action: 'create', loginId: LOGIN.toLowerCase(), fullName: 'Someone Else', password: 'Temp-pass-123' })).status, 400, 'Login IDs are unique (not case-sensitive)');
  const u = r.data.users.find(x => x.id === userId);
  assert.equal(u.mustChange, true);
  const raw = JSON.parse(sql(`SELECT password_hash FROM mc_users WHERE id = '${userId}';`))[0].results[0].password_hash;
  assert.match(raw, /^\d+:[0-9a-f]{32}:[0-9a-f]{64}$/, 'stored as a PBKDF2 hash, never in plain text');
  assert.ok(!raw.includes('Temp-pass-123'));
});

test('no email sign-in; a temporary password must be changed first', async () => {
  assert.equal((await login('someone@example.com', 'Temp-pass-123')).status, 401);
  const s = await login(LOGIN, 'Temp-pass-123');
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.ok(s.cookie && s.data.user.mustChange);
  assert.equal((await mc(s, 'dashboard')).status, 403, 'only the password change until then');
  assert.equal((await mc(s, 'password', 'POST', { current: 'Temp-pass-123', password: 'short' })).status, 400);
  assert.equal((await mc(s, 'password', 'POST', { current: 'Temp-pass-123', password: 'Temp-pass-123' })).status, 400, 'not the same as the temporary one');
  assert.equal((await mc(s, 'password', 'POST', { current: 'Temp-pass-123', password: 'My-own-pass-456' })).status, 200);
  const d = await mc(s, 'dashboard');
  assert.equal(d.status, 200, JSON.stringify(d.data));
  assert.ok(Array.isArray(d.data.drafts) && Array.isArray(d.data.deadlines));
});

test('CSRF: changes need the session token and must come from this website', async () => {
  const s = await login(LOGIN, 'My-own-pass-456');
  assert.equal((await mc(s, 'items', 'POST', { kind: 'news' }, { 'X-CSRF-Token': 'wrong' })).status, 403);
  assert.equal((await mc(s, 'logout', 'POST', {}, { Origin: 'https://evil.example' })).status, 403);
});

test('a Media Centre session is refused by every admin route (server-side)', async () => {
  const s = await login(LOGIN, 'My-own-pass-456');
  const H = { Cookie: s.cookie };
  for (const p of ['/api/admin/dashboard', '/api/admin/media-centre/users', '/api/admin/media-centre/approvals', '/api/admin/staff', '/api/admin/fans', '/api/admin/activity', '/api/admin/backup']) {
    assert.equal((await fetch(`${BASE}${p}`, { headers: H })).status, 403, `GET ${p}`);
    assert.equal((await fetch(`${BASE}${p}`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: '{}' })).status, 403, `POST ${p}`);
  }
  for (const p of ['/admin/dashboard/', '/admin/media-centre/', '/admin/']) assert.equal((await fetch(`${BASE}${p}`, { headers: H, redirect: 'manual' })).status, 403, `page ${p}`);
});

test('5 wrong passwords lock the account for 15 minutes; a Super Admin can unlock', async () => {
  const from = ip();
  for (let i = 0; i < 4; i++) assert.equal((await login(LOGIN, 'Wrong-pass-000', from)).status, 401);
  assert.equal((await login(LOGIN, 'Wrong-pass-000', from)).status, 423);
  assert.equal((await login(LOGIN, 'My-own-pass-456', from)).status, 423, 'locked even with the right password');
  assert.equal((await admin('users', { action: 'unlock', id: userId })).status, 200);
  assert.equal((await login(LOGIN, 'My-own-pass-456', from)).status, 200);
});

test('30 minutes without activity ends the session; disabling signs out at once', async () => {
  const s = await login(LOGIN, 'My-own-pass-456');
  assert.equal((await mc(s, 'dashboard')).status, 200);
  sql(`UPDATE mc_sessions SET last_seen = '${new Date(Date.now() - 31 * 60e3).toISOString()}' WHERE user_id = '${userId}' AND ended_at IS NULL;`);
  assert.equal((await mc(s, 'dashboard')).status, 401);
  const s2 = await login(LOGIN, 'My-own-pass-456');
  assert.equal((await admin('users', { action: 'disable', id: userId })).status, 200);
  assert.equal((await mc(s2, 'dashboard')).status, 401);
  assert.equal((await login(LOGIN, 'My-own-pass-456')).status, 403);
  assert.equal((await admin('users', { action: 'enable', id: userId })).status, 200);
});

test('reset password and change Login ID', async () => {
  assert.equal((await admin('users', { action: 'reset_password', id: userId, password: 'Reset-pass-789' })).status, 200);
  const s = await login(LOGIN, 'Reset-pass-789');
  assert.equal(s.status, 200); assert.equal(s.data.user.mustChange, true);
  const NEW = `${LOGIN.replace(/\d+$/, '')}77`;
  assert.equal((await admin('users', { action: 'login_id', id: userId, loginId: 'bad id' })).status, 400);
  assert.equal((await admin('users', { action: 'login_id', id: userId, loginId: NEW })).status, 200);
  assert.equal((await login(NEW, 'Reset-pass-789')).status, 200);
});

test('the activity log records it all, cannot be changed, and downloads as CSV', async () => {
  const d = (await admin(`activity?user=${userId}`)).data;
  const acts = new Set(d.rows.map(r => r.action));
  for (const a of ['login', 'failed_login', 'change_password', 'account_locked', 'logout']) assert.ok(acts.has(a), `logged: ${a}`);
  const all = (await admin('activity?section=users')).data.rows.map(r => r.action);
  for (const a of ['create_user', 'unlock_user', 'disable_user', 'enable_user', 'reset_password', 'change_login_id']) assert.ok(all.includes(a), `logged: ${a}`);
  assert.ok(d.rows.every(r => r.at && r.actor_name), 'who and when');
  assert.ok(d.rows.some(r => r.ip), 'IP address');
  const refused = (q, re) => { try { sql(q); } catch (e) { return re.test(`${e.stdout || ''}${e.stderr || ''}${e.message}`); } return false; };
  assert.ok(refused(`UPDATE mc_activity SET action = 'x' WHERE id = (SELECT MAX(id) FROM mc_activity);`, /cannot be changed/), 'UPDATE refused');
  assert.ok(refused(`DELETE FROM mc_activity WHERE id = (SELECT MAX(id) FROM mc_activity);`, /cannot be deleted/), 'DELETE refused');
  const csv = await fetch(`${BASE}/api/admin/media-centre/activity?format=csv&user=${userId}`, { headers: ADMIN });
  assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(await csv.text(), /Time \(UTC\),Who/);
});

test('the Approval Queue and settings open for Super Admins; the page needs a staff login', async () => {
  const q = await admin('approvals');
  assert.equal(q.status, 200); assert.ok(Array.isArray(q.data.items));
  const s = await admin('settings');
  assert.equal(s.data.categories.filter(c => c.preset).length, 17, 'the 17 preset categories');
  assert.ok(!s.data.categories.some(c => /women|academy/i.test(c.name)));
  assert.equal((await admin('settings', { action: 'category_add', name: "Women's Team", tab: 'Club' })).status, 400);
  assert.equal((await fetch(`${BASE}/api/admin/media-centre/users`)).status, 401);
  const page = await fetch(`${BASE}/media-centre/login/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy') || '', /frame-ancestors 'self'/);
  assert.match(page.headers.get('x-robots-tag') || '', /noindex/);
  assert.match(await page.text(), /Media Centre/);
});
