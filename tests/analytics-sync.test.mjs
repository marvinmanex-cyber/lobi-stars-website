// Analytics intelligence, Phase 2: the Google sign-in (JWT) and the daily sync of
// Search Console and GA4 figures into the database.
// The server tests need the local Pages dev server with ADMIN_CODE=test-code-123,
// CRON_SECRET=cron-test-secret and ANALYTICS_SYNC_FAKE=1 (pretend Google answers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signedAssertion, accessToken } from '../functions/api/_lib/googleAuth.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const CRON = process.env.CRON_SECRET || 'cron-test-secret';

const b64 = buf => Buffer.from(buf).toString('base64');
async function testAccount() {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
  const pem = `-----BEGIN PRIVATE KEY-----\n${b64(der).match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  return { kp, json: JSON.stringify({ type: 'service_account', client_email: 'sync@lobi-test.iam.gserviceaccount.com', private_key: pem }) };
}

test('the Google sign-in: a valid RS256 JWT, swapped for a token that is reused', async () => {
  const { kp, json } = await testAccount();
  const sa = JSON.parse(json);
  const jwt = await signedAssertion({ email: sa.client_email, key: sa.private_key }, 1700000000);
  const [h, c, sig] = jwt.split('.');
  const dec = x => JSON.parse(Buffer.from(x, 'base64url').toString());
  assert.deepEqual(dec(h), { alg: 'RS256', typ: 'JWT' });
  const claims = dec(c);
  assert.equal(claims.iss, sa.client_email);
  assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(claims.exp - claims.iat, 3600);
  assert.match(claims.scope, /webmasters\.readonly/);
  assert.match(claims.scope, /analytics\.readonly/);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', kp.publicKey, Buffer.from(sig, 'base64url'), new TextEncoder().encode(`${h}.${c}`));
  assert.equal(ok, true, 'signature verifies with the public key');

  // The key pasted with escaped line breaks (\n as text) also works.
  const escaped = { email: sa.client_email, key: sa.private_key.replace(/\n/g, '\\n') };
  assert.ok(await signedAssertion(escaped));

  let calls = 0;
  const fakeToken = async (url, opts) => { calls++; assert.match(String(opts.body), /grant_type=urn%3Aietf/); return new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }), { status: 200 }); };
  const env = { GOOGLE_SERVICE_ACCOUNT_JSON: json };
  assert.equal(await accessToken(env, fakeToken), 'tok-1');
  assert.equal(await accessToken(env, fakeToken), 'tok-1');
  assert.equal(calls, 1, 'token reused until close to expiry');
  await assert.rejects(accessToken({}, fakeToken), /not set/);
  await assert.rejects(accessToken({ GOOGLE_SERVICE_ACCOUNT_JSON: '{"x":1}' }, fakeToken), /not a service account/);
});

test('sync endpoints are protected', async () => {
  assert.equal((await fetch(`${BASE}/api/internal/analytics-sync`, { method: 'POST' })).status, 403);
  assert.equal((await fetch(`${BASE}/api/internal/analytics-sync`, { method: 'POST', headers: { Authorization: 'Bearer wrong' } })).status, 403);
  assert.ok([401, 403].includes((await fetch(`${BASE}/api/admin/analytics-sync`)).status));
});

test('Sync now: 90 days in steps, then a re-sync updates rows without duplicates', async () => {
  const st = await fetch(`${BASE}/api/admin/analytics-sync`, { headers: ADMIN }).then(r => r.json());
  assert.equal(st.config.fake, true);
  assert.deepEqual(st.config.missing, []);
  assert.ok(!JSON.stringify(st).includes('PRIVATE KEY'));

  const start = await fetch(`${BASE}/api/admin/analytics-sync`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ action: 'sync', full: true }) }).then(r => r.json());
  assert.equal(start.ok, true);
  const days = (Date.parse(start.run.end) - Date.parse(start.run.start)) / 864e5 + 1;
  assert.equal(days, 90);
  let run = start.run;
  for (let i = 0; i < 80 && !run.done; i++) run = (await fetch(`${BASE}/api/admin/analytics-sync`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ action: 'step' }) }).then(r => r.json())).run;
  assert.equal(run.done, true);
  assert.deepEqual(run.failures, []);
  assert.ok(run.rows > 1000, 'pages of 1,000 rows were followed');

  const after = await fetch(`${BASE}/api/admin/analytics-sync`, { headers: ADMIN }).then(r => r.json());
  assert.ok(after.lastSuccess && after.lastSuccess.rows === run.rows);
  // 90 days × (1 total + 4 pages + 5 queries + 3 countries + 3 devices); 90 × 24 traffic rows (4 pages × 3 channels × 2 devices); 90 × 11 events.
  assert.equal(after.counts.gsc, 90 * 16);
  assert.equal(after.counts.ga4, 90 * 24);
  assert.equal(after.counts.events, 90 * 11);

  // Short re-sync (last 4 days) through the timer job: same row counts (upserts).
  await fetch(`${BASE}/api/admin/analytics-sync`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ action: 'sync' }) });
  let more = true;
  for (let i = 0; i < 30 && more; i++) more = (await fetch(`${BASE}/api/internal/analytics-sync`, { method: 'POST', headers: { Authorization: `Bearer ${CRON}` } }).then(r => r.json())).more;
  assert.equal(more, false);
  const again = await fetch(`${BASE}/api/admin/analytics-sync`, { headers: ADMIN }).then(r => r.json());
  assert.equal(again.run.done, true);
  assert.equal((Date.parse(again.run.end) - Date.parse(again.run.start)) / 864e5 + 1, 4);
  assert.equal(again.counts.gsc, after.counts.gsc);
  assert.equal(again.counts.ga4, after.counts.ga4);

  // Once synced today, the timer job has nothing to do.
  const idle = await fetch(`${BASE}/api/internal/analytics-sync`, { method: 'POST', headers: { Authorization: `Bearer ${CRON}` } }).then(r => r.json());
  assert.equal(idle.more, false);
});

test('Google & Search figures for the Analytics page (Phase 3)', async () => {
  assert.ok([401, 403].includes((await fetch(`${BASE}/api/admin/analytics-google`)).status));
  const g = await fetch(`${BASE}/api/admin/analytics-google?range=30d`, { headers: ADMIN }).then(r => r.json());
  assert.equal(g.daily.days.length, 30);
  for (const k of ['views', 'sessions', 'clicks', 'impressions']) assert.equal(g.daily[k].length, 30);
  assert.ok(g.gsc.now.impressions > 0 && g.gsc.now.clicks <= g.gsc.now.impressions);
  assert.ok(g.gsc.now.position >= 1);
  assert.ok(g.ga4.now.sessions > 0 && g.ga4.now.engagement <= 100);
  assert.ok(g.gsc.queries.length > 0 && g.gsc.queries.length <= 20);
  assert.equal(g.ga4.events.length, 10, 'the 10 key events, without page_view');
  // Search Console page addresses are matched to the site's own paths.
  const tickets = g.pages.find(p => p.path === '/tickets/');
  assert.ok(tickets && tickets.clicks > 0 && tickets.sessions > 0);
  assert.ok(!g.pages.some(p => /^https?:/.test(p.path)));
  assert.equal(g.status.hasData, true);
  assert.ok(!JSON.stringify(g).includes('PRIVATE KEY'));
});
