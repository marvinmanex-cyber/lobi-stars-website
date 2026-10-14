// Lobi Stars Rewards Terms: approved text by default (no DRAFT), editable by
// admins at any time (validated, dated today, audit-logged), restorable, and
// served to the public page. Needs the local Pages dev server (ADMIN_CODE=test-code-123).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const call = (method, p, body, headers = ADMIN) => fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));

after(async () => { await call('PUT', '/api/admin/rewards/terms', { reset: true }); });

test('the approved terms: no DRAFT notice, Star Points wording', async () => {
  const html = await (await fetch(`${BASE}/rewards/terms/`)).text();
  assert.ok(!/DRAFT/.test(html), 'no draft banner');
  assert.match(html, /Star Points/); assert.ok(!/Pride Points/.test(html));
  const pub = (await call('GET', '/api/rewards/terms', undefined, {})).data;
  assert.match(pub.body, /## 1\. Who can join/);
});

test('admins can change the terms at any time; the public page gets the new version', async () => {
  assert.equal((await call('GET', '/api/admin/rewards/terms', undefined, { 'Content-Type': 'application/json' })).status, 401);
  assert.equal((await call('PUT', '/api/admin/rewards/terms', { body: 'Too short' })).status, 400);
  const cur = (await call('GET', '/api/admin/rewards/terms')).data;
  const body = cur.defaultBody.replace('## 6. Expiry', '## 6. Expiry of Star Points') + '\n\n## 12. Test section\n- A new rule <script>alert(1)</script> added by the club.';
  const r = await call('PUT', '/api/admin/rewards/terms', { body });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.custom, true);
  assert.equal(r.data.updated, new Date(Date.now() + 3600e3).toISOString().slice(0, 10), 'dated today (Nigerian time)');
  const pub = (await call('GET', '/api/rewards/terms', undefined, {})).data;
  assert.match(pub.body, /## 12\. Test section/); assert.ok(!/<script>/.test(pub.body), 'HTML removed');
  assert.equal((await call('PUT', '/api/admin/rewards/terms', { reset: true })).data.custom, false);
});
