// Website Super Admins sign in to the separate staff areas (Media Centre, IT
// Centre / Squad Data Portal, MatchDay Kitchen) with their website email and
// password; other website accounts can't; the area session never opens /admin.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './media-helpers.mjs';
import { hashPassword } from '../functions/api/_lib/password.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const T = Math.random().toString(36).slice(2, 8).replace(/\d/g, 'q');
const SA = `areas-sa-${T}@example.com`, STAFF = `areas-staff-${T}@example.com`, PW = 'Areas-Super-2026!';
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const post = (p, body) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify(body) })
  .then(async r => ({ status: r.status, data: await r.json().catch(() => ({})), cookie: r.headers.get('set-cookie') || '' }));

before(async () => {
  const h = await hashPassword(PW);
  sql(`INSERT INTO admin_users (id, name, email, password_hash, role, active, test_account) VALUES ('sa_${T}', 'Area Super ${T}', '${SA}', '${h}', 'super_admin', 1, 1), ('st_${T}', 'Area Staff ${T}', '${STAFF}', '${h}', 'staff', 1, 1);`);
});
after(() => sql(`DELETE FROM mc_sessions WHERE user_id = 'admin:sa_${T}'; DELETE FROM admin_users WHERE id IN ('sa_${T}', 'st_${T}');`));

test('Media Centre: a Super Admin signs in with the website email and sees everything, including the Approval Queue', async () => {
  const r = await post('/api/media-centre/login', { loginId: SA.toUpperCase(), password: PW });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.user.admin, true); assert.equal(r.data.user.fullName, `Area Super ${T}`);
  const cookie = r.cookie.match(/ls_media=[^;]+/)[0];
  const get = p => fetch(`${BASE}/api/media-centre/${p}`, { headers: { Cookie: cookie } });
  assert.equal((await get('dashboard')).status, 200);
  assert.equal((await get('approvals')).status, 200);
  assert.ok([401, 403].includes((await fetch(`${BASE}/api/admin/me`, { headers: { Cookie: cookie } })).status), 'never the admin back end');
  assert.equal((await post('/api/media-centre/login', { loginId: STAFF, password: PW })).status, 403, 'only Super Admins');
  assert.equal((await post('/api/media-centre/login', { loginId: SA, password: 'wrong-password' })).status, 401);
});

test('IT Centre: a Super Admin signs in with the website email (no shared login, no name needed)', async () => {
  const r = await post('/api/squad-portal/login', { username: SA, password: PW });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.name, `Area Super ${T}`);
  assert.equal((await post('/api/squad-portal/login', { username: STAFF, password: PW })).status, 403);
  assert.equal((await post('/api/squad-portal/login', { username: SA, password: 'wrong-password' })).status, 401);
});

test('MatchDay Kitchen: the same email and password', async () => {
  const r = await post('/api/matchday-kitchen/login', { login: SA, password: PW });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});
