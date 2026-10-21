// Inbox: Delete (to the Deleted tab, restorable for 30 days), Restore, and
// Delete forever (Super Admins only, with the original form message, so it
// never comes back). Deleted conversations are hidden everywhere else.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123 and
// INBOX_INBOUND_KEY=test-inbound INBOX_REPLY_DOMAIN=reply.lobistarsfc.com.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const KEY = process.env.INBOX_INBOUND_KEY || 'test-inbound';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const get = (path, headers = ADMIN) => fetch(BASE + path, { headers }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const post = (path, body, headers = ADMIN) => fetch(BASE + path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const made = [];
after(async () => { for (const id of made) await fetch(`${BASE}/api/admin/staff/${id}`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ active: false, reason: 'test finished' }) }); });

async function staff(role) {
  const email = `ibd-${role}-${uid()}@example.com`;
  const r = await post('/api/admin/staff', { name: `Del ${role}`, email, password: 'Role-Test-2026!', role });
  made.push(r.data.id);
  const login = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
  return { Cookie: login.headers.get('set-cookie').split(';')[0] };
}
async function newMessage() {
  const email = `del-${uid()}@example.com`;
  const r = await fetch(`${BASE}/api/enquiry`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() },
    body: JSON.stringify({ form: 'contact', first_name: 'Tersoo', last_name: 'Delete', email, subject: `Delete me ${uid()}`, message: 'Please ignore this test message.' }) });
  assert.equal(r.status, 200);
  const ref = (await r.json()).ref;
  const thread = (await get(`/api/admin/inbox?q=${encodeURIComponent(email)}`)).data.threads[0];
  return { email, ref, thread };
}
const inTab = async (tab, email) => (await get(`/api/admin/inbox?tab=${tab}&q=${encodeURIComponent(email)}`)).data.threads.length;

test('Delete moves a conversation to the Deleted tab; Restore brings it back', async () => {
  const m = await newMessage();
  const before = (await get('/api/admin/inbox')).data.counts;
  assert.equal((await post(`/api/admin/inbox/${m.thread.id}`, { action: 'delete' })).status, 200);
  assert.equal(await inTab('all', m.email), 0, 'hidden from All');
  assert.equal(await inTab('deleted', m.email), 1, 'shown in Deleted');
  const counts = (await get('/api/admin/inbox')).data.counts;
  assert.equal(counts.deleted, (before.deleted || 0) + 1);
  const t = (await get(`/api/admin/inbox/${m.thread.id}`)).data.thread;
  assert.ok(t.deleted_at && t.deleted_by, 'who and when');
  assert.equal((await post(`/api/admin/inbox/${m.thread.id}`, { action: 'reply', html: '<p>Hello</p>' })).status, 409, 'no replies while deleted');
  assert.equal((await post(`/api/admin/inbox/${m.thread.id}`, { action: 'restore' })).status, 200);
  assert.equal(await inTab('all', m.email), 1, 'back in All');
  assert.equal(await inTab('deleted', m.email), 0);
});

test("a fan's reply to a deleted conversation brings it back", async () => {
  const m = await newMessage();
  await post(`/api/admin/inbox/${m.thread.id}`, { action: 'delete' });
  const r = await fetch(`${BASE}/api/inbox/inbound?key=${KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'email.received', data: { from: `Tersoo <${m.email}>`, to: [`reply+${m.ref.toLowerCase()}@reply.lobistarsfc.com`], subject: `Re: [${m.ref}]`, text: 'One more question please.' } }) });
  assert.equal(r.status, 200);
  assert.equal(await inTab('all', m.email), 1);
  assert.equal(await inTab('deleted', m.email), 0);
});

test('Delete forever: Super Admins only, only from Deleted, removes the form message so it never comes back', async () => {
  const m = await newMessage();
  const fanSupport = await staff('fan_support');
  assert.equal((await post(`/api/admin/inbox/${m.thread.id}`, { action: 'delete_forever' })).status, 400, 'must be in Deleted first');
  assert.equal((await post(`/api/admin/inbox/${m.thread.id}`, { action: 'delete' }, fanSupport)).status, 200, 'staff who can reply can delete');
  assert.equal((await post(`/api/admin/inbox/${m.thread.id}`, { action: 'delete_forever' }, fanSupport)).status, 403, 'not a Super Admin');
  assert.equal((await post(`/api/admin/inbox/${m.thread.id}`, { action: 'delete_forever' })).status, 200);
  assert.equal((await get(`/api/admin/inbox/${m.thread.id}`)).status, 404);
  // Opening the Inbox again (which re-reads the form messages) does not bring it back.
  assert.equal(await inTab('all', m.email), 0);
  assert.equal(await inTab('deleted', m.email), 0);
  const fans = (await get(`/api/admin/fans?q=${encodeURIComponent(m.email)}`)).data;
  assert.equal((fans.contacts || fans.rows || fans.items || []).length, 0, 'no other record: gone from the fan database too');
  const log = (await get('/api/admin/activity?q=inbox_delete')).data;
  assert.ok(JSON.stringify(log).includes(m.ref), 'logged in the Activity Log');
});

test("staff can't delete messages their role doesn't show them", async () => {
  const m = await newMessage();
  const editor = await staff('content_editor'); // sees only the media@ mailbox: this fan message is not theirs
  assert.equal((await post(`/api/admin/inbox/${m.thread.id}`, { action: 'delete' }, editor)).status, 404);
  assert.equal(await inTab('all', m.email), 1);
});
