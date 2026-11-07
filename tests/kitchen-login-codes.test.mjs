// Choosing login codes: weak codes refused, a code that's taken isn't given away, staff change their own.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './media-helpers.mjs';
import { hashPassword } from '../functions/api/_lib/password.js';
import { weakCodeReason } from '../functions/api/_lib/matchdayKitchen.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const T = Date.now().toString(36).toUpperCase();
const EMAIL = `lc-${T.toLowerCase()}@example.com`, PW = 'Kitchen-Super-2026!';
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
// A fresh, valid code for this run (random, so runs don't collide).
const fresh = () => { for (;;) { const c = String(Math.floor(Math.random() * 1e8)).padStart(8, '0'); if (!weakCodeReason(c)) return c; } };

test('weak codes are refused, ordinary ones pass', () => {
  for (const c of ['11111111', '12345678', '87654321', '90123456', '12121212', '45674567', '12344321', '11112222', '11223344', '15061990', '19901506', '31122000', '1234567', '123456789', '']) assert.ok(weakCodeReason(c), c);
  for (const c of ['48261937', '7305-1846', '29470618', '31139999']) assert.equal(weakCodeReason(c), null, c);
});

async function as(body) {
  const r = await fetch(`${BASE}/api/matchday-kitchen/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify(body) });
  const cookie = (r.headers.get('set-cookie') || '').match(/ls_mdk=([^;]+)/)?.[1];
  if (!cookie) return { status: r.status, ok: false };
  const s = await fetch(`${BASE}/api/matchday-kitchen/session`, { headers: { Cookie: `ls_mdk=${cookie}` } }).then(x => x.json());
  const json = async (p, b) => { const x = await fetch(`${BASE}/api/matchday-kitchen/${p}`, b ? { method: 'POST', headers: { Cookie: `ls_mdk=${cookie}`, 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf }, body: JSON.stringify(b) } : { headers: { Cookie: `ls_mdk=${cookie}` } }); return { status: x.status, data: await x.json().catch(() => ({})) }; };
  return { ok: true, s, json };
}

test('choosing codes: when adding, when editing, and your own', async () => {
  await fetch(`${BASE}/api/matchday-kitchen/session`);
  sql(`INSERT INTO admin_users (id, name, email, password_hash, role, active, test_account) VALUES ('lc_${T}', 'LC Admin', '${EMAIL}', '${await hashPassword(PW)}', 'super_admin', 1, 1);`);
  const A = await as({ login: EMAIL, password: PW });
  // Adding with a chosen code: that code signs them in.
  const c1 = fresh();
  const add = await A.json('staff', { action: 'add', name: `LC Cook ${T}`, role: 'cook', loginCode: `${c1.slice(0, 4)}-${c1.slice(4)}` });
  assert.equal(add.status, 200, JSON.stringify(add.data)); assert.equal(add.data.loginCode, `${c1.slice(0, 4)}-${c1.slice(4)}`);
  const cook = await as({ loginCode: c1 }); assert.ok(cook.ok, 'signs in with the chosen code');
  // Weak and taken codes are refused; a taken one doesn't say why.
  const weak = await A.json('staff', { action: 'add', name: `LC Weak ${T}`, role: 'cook', loginCode: '12345678' });
  assert.equal(weak.status, 400); assert.match(weak.data.error, /counting/);
  const taken = await A.json('staff', { action: 'add', name: `LC Taken ${T}`, role: 'pass', loginCode: c1 });
  assert.equal(taken.status, 400); assert.doesNotMatch(taken.data.error, /taken|already|someone|another/i);
  // Empty still makes a random code.
  const rnd = await A.json('staff', { action: 'add', name: `LC Pass ${T}`, role: 'pass', loginCode: '' });
  assert.match(rnd.data.loginCode, /^\d{4}-\d{4}$/);
  // Editing: a Super Admin chooses a new code for someone; the old one stops working.
  const c2 = fresh();
  const ed = await A.json('staff', { action: 'edit', id: rnd.data.id, name: `LC Pass ${T}`, role: 'pass', active: true, loginCode: c2 });
  assert.equal(ed.status, 200); assert.equal(ed.data.loginCode, `${c2.slice(0, 4)}-${c2.slice(4)}`);
  assert.equal((await as({ loginCode: rnd.data.loginCode })).ok, false);
  assert.ok((await as({ loginCode: c2 })).ok);
  // The cook changes their own code.
  const c3 = fresh();
  assert.equal((await cook.json('my-code', { current: '00000000', code: c3, confirm: c3 })).status, 400, 'wrong current code');
  assert.match((await cook.json('my-code', { current: c1, code: c3, confirm: fresh() })).data.error, /don't match/);
  assert.match((await cook.json('my-code', { current: c1, code: '11223344', confirm: '11223344' })).data.error || '', /./);
  assert.equal((await cook.json('my-code', { current: c1, code: c2, confirm: c2 })).status, 400, "someone else's code");
  const other = await as({ loginCode: c1 }); // a second tablet
  const ok = await cook.json('my-code', { current: c1, code: `${c3.slice(0, 4)}-${c3.slice(4)}`, confirm: c3 });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal((await cook.json('session')).status, 200, 'this tablet stays signed in');
  assert.equal((await other.json('session')).status, 401, 'the other tablet is signed out');
  assert.equal((await as({ loginCode: c1 })).ok, false, 'old code stops working');
  assert.ok((await as({ loginCode: c3 })).ok, 'new code works');
  assert.equal((await A.json('my-code', { current: c1, code: c3, confirm: c3 })).status, 400, 'Super Admins have no code');
});

after(() => { sql(`DELETE FROM mk_staff WHERE full_name LIKE 'LC % ${T}'; DELETE FROM admin_users WHERE email = '${EMAIL}';`); });
