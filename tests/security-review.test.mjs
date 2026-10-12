// Security review (12 October 2026): frame / HTTPS / permissions headers on
// pages built by Functions, guessing limits on email-code sign-in across
// codes, unverified "delete my data" requests don't add anyone to the fan
// database, and the confirm page sends no referrer.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123 and FANS_DEV_LINKS=1.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;

test('security headers on admin pages, share links and server-rendered pages', async () => {
  const pages = [
    fetch(`${BASE}/admin/dashboard/`, { headers: ADMIN, redirect: 'manual' }),
    fetch(`${BASE}/m/does-not-exist-${uid()}`, { redirect: 'manual' }).then(() => fetch(`${BASE}/programme/`)),
    fetch(`${BASE}/fixtures/`),
  ];
  for (const r of await Promise.all(pages)) {
    assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN', r.url);
    assert.match(r.headers.get('content-security-policy') || '', /frame-ancestors 'self'/, r.url);
    assert.match(r.headers.get('strict-transport-security') || '', /max-age=\d+/, r.url);
    assert.doesNotMatch(r.headers.get('strict-transport-security') || '', /includeSubDomains/, 'stream subdomain points to the partner');
    assert.match(r.headers.get('permissions-policy') || '', /camera=\(self\)/, r.url);
  }
  const conf = await (await fetch(`${BASE}/programme/confirm/`)).text();
  assert.match(conf, /<meta name="referrer" content="no-referrer"/);
});

test('email-code sign-in: at most 10 wrong tries per email an hour, even with new codes', async () => {
  const email = `guess-${uid()}@example.com`;
  const H = () => ({ 'Content-Type': 'application/json', Origin: BASE, 'CF-Connecting-IP': randIp() });
  const post = (a, body) => fetch(`${BASE}/api/fan/auth/${a}`, { method: 'POST', headers: H(), body: JSON.stringify(body) });
  let codes = 0, statuses = [];
  for (let i = 0; i < 12; i++) {
    if (i % 4 === 0 && codes < 3) { await post('request', { email }); codes++; }
    statuses.push((await post('verify', { email, code: '000000' })).status);
  }
  assert.ok(statuses.slice(0, 10).every(s => s === 400), statuses.join(','));
  assert.deepEqual(statuses.slice(10), [429, 429], 'blocked after 10 tries in an hour');
});

test('unverified "delete my data" requests reach the Inbox but add nobody to the fan database', async () => {
  const email = `stranger-${uid()}@example.com`;
  const r = await fetch(`${BASE}/api/fan/delete-request`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ email }) });
  assert.equal(r.status, 200);
  const inbox = await (await fetch(`${BASE}/api/admin/inbox?q=${encodeURIComponent(email)}`, { headers: ADMIN })).json();
  assert.ok(JSON.stringify(inbox).includes('Data deletion request'));
  const fans = await (await fetch(`${BASE}/api/admin/fans?q=${encodeURIComponent(email)}`, { headers: ADMIN })).json();
  assert.equal((fans.rows || fans.fans || []).filter(x => x.email === email).length, 0, 'not added to the fan database');
});
