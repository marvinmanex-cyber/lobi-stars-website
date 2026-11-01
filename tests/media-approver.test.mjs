// Media approver: a designated media staff member signs in to the Media Centre
// with the approval password only (set by a Super Admin, never sent back),
// sees only the Approval Queue, approves / returns / rejects; recorded and
// shown as "Media approver", never a name; a new password signs them out.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './media-helpers.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const T = Math.random().toString(36).slice(2, 8).replace(/\d/g, 'x');
const LOGIN = `Writer${T}${String(Math.floor(Math.random() * 90) + 10)}`;
const PW = `Approve-${T}-2026`;
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const admin = (p, body) => fetch(`${BASE}/api/admin/media-centre/${p}`, body ? { method: 'POST', headers: ADMIN, body: JSON.stringify(body) } : { headers: ADMIN }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
async function signIn(body) {
  const r = await fetch(`${BASE}/api/media-centre/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, data: d, S: r.ok ? { cookie: r.headers.get('set-cookie').match(/ls_media=[^;]+/)[0], csrf: d.csrf } : null };
}
const call = (S, p, method = 'GET', body) => fetch(`${BASE}/api/media-centre/${p}`, { method, headers: { Cookie: S.cookie, 'X-CSRF-Token': S.csrf, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
let W;

before(async () => {
  assert.equal((await admin('users', { action: 'create', loginId: LOGIN, fullName: 'Wale Writer', password: 'Temp-pass-123' })).status, 200);
  W = (await signIn({ loginId: LOGIN, password: 'Temp-pass-123' })).S;
  await call(W, 'password', 'POST', { current: 'Temp-pass-123', password: 'Own-pass-456' });
});
after(() => sql(`DELETE FROM mc_items WHERE created_by IN (SELECT id FROM mc_users WHERE login_key = '${LOGIN.toLowerCase()}'); DELETE FROM mc_sessions WHERE user_id = '__approver__' OR user_id IN (SELECT id FROM mc_users WHERE login_key = '${LOGIN.toLowerCase()}'); DELETE FROM mc_users WHERE login_key = '${LOGIN.toLowerCase()}';`));

test('a Super Admin sets the approval password (never sent back); the approver signs in with it only', async () => {
  assert.equal((await admin('settings', { action: 'approver_password', password: 'short' })).status, 400);
  const set = await admin('settings', { action: 'approver_password', password: PW });
  assert.equal(set.status, 200, JSON.stringify(set.data));
  const s = (await admin('settings')).data.settings;
  assert.equal(s.approverSet, true); assert.equal(s.approver_password_hash, undefined, 'the stored password never leaves the server');
  assert.equal((await signIn({ approver: true, password: 'wrong-password-1' })).status, 401);
  const a = await signIn({ approver: true, password: PW });
  assert.equal(a.status, 200); assert.equal(a.data.user.fullName, 'Media approver'); assert.equal(a.data.user.approver, true);
  // Only the Approval Queue: nothing else in the Media Centre; and writers can't open the queue.
  assert.equal((await call(a.S, 'dashboard')).status, 403);
  assert.equal((await call(a.S, 'items?kind=news')).status, 403);
  assert.equal((await call(a.S, 'approvals')).status, 200);
  assert.equal((await call(W, 'approvals')).status, 403);
});

test('the approver returns and approves; recorded as "Media approver"; no approver name shown in the Media Centre', async () => {
  const a = (await signIn({ approver: true, password: PW })).S;
  const day = new Date().toISOString().slice(0, 10);
  const id = (await call(W, 'items', 'POST', { kind: 'press', data: { date: day } })).data.id;
  await call(W, `items/${id}`, 'PUT', { data: { headline: `Approver test ${T}`, date: day, location: 'MAKURDI', body: '<p>Lobi Stars FC confirms a new community programme for young fans across Benue State this season.</p>', quote: 'We are proud.', quoteBy: 'Chairman' } });
  assert.equal((await call(W, `items/${id}`, 'POST', { action: 'submit' })).status, 200);
  const q = (await call(a, 'approvals')).data.items;
  assert.ok(q.some(i => i.id === id), 'in the queue');
  const one = (await call(a, `approvals?id=${id}`)).data;
  assert.ok(one.previewHtml.includes(T), 'with a preview');
  assert.equal((await call(a, 'approvals', 'POST', { id, decision: 'unpublish' })).status, 400, 'only approve / return / reject');
  assert.equal((await call(a, 'approvals', 'POST', { id, decision: 'return', comment: 'Add the date of the launch.' })).status, 200);
  const back = (await call(W, `items/${id}`)).data;
  assert.equal(back.item.status, 'returned'); assert.equal(back.item.decidedBy, null, 'no name shown to the writer');
  assert.ok(back.revisions.every(r => r.event !== 'returned' || !r.by_name), 'no name in the history either');
  assert.equal((await call(W, `items/${id}`, 'POST', { action: 'submit' })).status, 200);
  const ok = await call(a, 'approvals', 'POST', { id, decision: 'approve' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const log = JSON.parse(sql(`SELECT actor_name, action FROM mc_activity WHERE item_id = '${id}' AND action IN ('approve', 'return') ORDER BY id;`))[0].results;
  assert.ok(log.length >= 2 && log.every(l => l.actor_name === 'Media approver'), JSON.stringify(log));
});

test('a new approval password signs out anyone using the old one', async () => {
  const a = (await signIn({ approver: true, password: PW })).S;
  assert.equal((await admin('settings', { action: 'approver_password', password: `${PW}-new` })).status, 200);
  assert.equal((await call(a, 'approvals')).status, 401);
  assert.equal((await signIn({ approver: true, password: PW })).status, 401);
});
