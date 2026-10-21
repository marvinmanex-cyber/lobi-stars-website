// Lobi Stars FC Live × Aeson Sports Radio: partner settings (L1), /api/live-status (L2),
// the signed webhook (L3), and the status feed in Test stream (L5).
// Needs the local Pages dev server with ADMIN_CODE=test-code-123.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { cleanStatus, verifySignature, signPayload, validStatusUrl } from '../functions/api/_lib/partnerRadio.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const SECRET = `partner-test-secret-${Math.random().toString(36).slice(2)}-0123456789`;
const admin = async () => (await fetch(`${BASE}/api/admin/commentary`, { headers: ADMIN })).json();
let saved;
async function put(extra) {
  saved ||= (await admin()).settings;
  const s = saved;
  return fetch(`${BASE}/api/admin/commentary`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({
    enabled: s.enabled, streamUrl: s.streamUrl === '/live/commentary' ? '' : s.streamUrl, backupUrl: s.backupUrl, commentators: s.commentators, maxListeners: String(s.maxListeners), ...extra,
  }) });
}
async function hook(body, { secret = SECRET, ts = Math.floor(Date.now() / 1000), sig } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const signature = sig ?? `sha256=${await signPayload(secret, ts, raw)}`;
  return fetch(`${BASE}/api/aeson-webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Aeson-Timestamp': String(ts), 'X-Aeson-Signature': signature }, body: raw });
}
const liveStatus = async () => (await fetch(`${BASE}/api/live-status`)).json();
after(async () => { await hook({ onAir: false, listeners: 0 }).catch(() => {}); await put({ partnerStatusUrl: '' }).catch(() => {}); });

test('partner text is cleaned: no partner names, software, links or its own listen addresses', () => {
  const s = cleanStatus({
    onAir: true, isLiveDJ: true, listeners: '37', listenUrl: 'https://radio.aesonsports.com/live.mp3', backupListenUrl: 'https://x.example/b',
    broadcast: { title: 'Aeson Sports Radio – Lobi Stars v Kada (www.aesonsports.com)', commentators: 'Terna Akaa & Aeson Bello', startedAt: '2026-11-07T15:45:00Z',
      liveMatch: { home: 'Lobi Stars', away: 'Kada <b>Warriors</b>', homeScore: 2, awayScore: '1', minute: "67'", scorers: [{ player: 'Musa Ali', minute: "12'", team: 'home' }] } },
  });
  const all = JSON.stringify(s);
  assert.equal(s.onAir, true);
  assert.equal(s.listeners, 37);
  assert.doesNotMatch(all, /aeson|https?:|www\.|listenUrl|<b>/i);
  assert.deepEqual(s.broadcast.commentators, ['Terna Akaa', 'Bello']);
  assert.equal(s.liveMatch.awayScore, 1);
  assert.equal(s.liveMatch.scorers[0].player, 'Musa Ali');
  assert.equal(cleanStatus({}).onAir, false);
  assert.ok(validStatusUrl('https://www.aesonsports.com/api/radio/status'));
  assert.ok(!validStatusUrl('http://example.com/status'));
});

test('webhook signatures: HMAC-SHA256 of "<timestamp>.<body>", five-minute window', async () => {
  const now = 1_800_000_000, body = '{"onAir":true}';
  const good = `sha256=${await signPayload('s3cret-value-0123456789abcdef', now, body)}`;
  assert.equal(await verifySignature('s3cret-value-0123456789abcdef', now, good, body, now), null);
  assert.ok(await verifySignature('s3cret-value-0123456789abcdef', now, good, body + ' ', now), 'changed body refused');
  assert.ok(await verifySignature('another-secret-0123456789abcdef', now, good, body, now), 'wrong secret refused');
  assert.ok(await verifySignature('s3cret-value-0123456789abcdef', now, good, body, now + 301), 'old message refused');
  assert.ok(await verifySignature('', now, good, body, now), 'no secret set: refused');
});

test('admin: status address and webhook secret saved; the secret is never sent back', async () => {
  assert.equal((await put({ partnerStatusUrl: 'http://example.com/status' })).status, 400);
  assert.equal((await put({ partnerWebhookSecret: 'too-short' })).status, 400);
  assert.equal((await put({ partnerStatusUrl: '', partnerWebhookSecret: SECRET })).status, 200);
  const res = await fetch(`${BASE}/api/admin/commentary`, { headers: ADMIN });
  const text = await res.text();
  assert.ok(!text.includes(SECRET), 'secret not returned');
  const d = JSON.parse(text);
  assert.equal(d.partner.webhookSecretSet, true);
  assert.equal(d.partner.statusUrl, '', 'blank = the standard address');
  assert.match(d.partner.webhookUrl, /\/api\/aeson-webhook$/);
  assert.ok([401, 403].includes((await fetch(`${BASE}/api/admin/commentary`)).status));
});

test('webhook: wrong or missing signature refused; a signed message flips the status straight away', async () => {
  const on = { onAir: true, listeners: 21, listenUrl: 'https://secret-partner.example/live.mp3', broadcast: { commentators: ['Terna Akaa'] } };
  assert.equal((await hook(on, { sig: '' })).status, 401);
  assert.equal((await hook(on, { secret: 'wrong-secret-0123456789abcdefgh' })).status, 401);
  assert.equal((await hook(on, { ts: Math.floor(Date.now() / 1000) - 900 })).status, 401);
  const ok = await hook(on);
  assert.equal(ok.status, 200);
  const s = await liveStatus();
  assert.equal(s.onAir, true);
  assert.equal(s.stale, false);
  assert.equal(s.listeners, 21);
  assert.deepEqual(s.broadcast.commentators, ['Terna Akaa']);
  assert.doesNotMatch(JSON.stringify(s), /aeson|secret-partner|listenUrl/i);
  assert.equal((await hook({ onAir: false, listeners: 0 })).status, 200);
  assert.equal((await liveStatus()).onAir, false);
  assert.equal((await fetch(`${BASE}/api/aeson-webhook`)).status, 405);
});

test('live-status: the expected fields; an unreachable feed means off air and stale, never an error', async () => {
  const s = await liveStatus();
  for (const k of ['onAir', 'listeners', 'broadcast', 'liveMatch', 'stale', 'live', 'state', 'upcoming', 'serverTime']) assert.ok(k in s, k);
  assert.equal((await put({ partnerStatusUrl: 'https://127.0.0.1:1/status' })).status, 200);
  const res = await fetch(`${BASE}/api/live-status`);
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.onAir, false);
  assert.equal(d.stale, true);
  assert.equal(d.live, d.state === 'live' && !!d.streamUrl, 'a stale feed does not block fans during a match window');
  const t = await (await fetch(`${BASE}/api/admin/commentary/test`, { method: 'POST', headers: ADMIN })).json();
  const feed = t.results.find(r => /status feed/i.test(r.name));
  assert.ok(feed && feed.ok === false, 'Test stream reports the unreachable feed');
  await put({ partnerStatusUrl: '' });
});
