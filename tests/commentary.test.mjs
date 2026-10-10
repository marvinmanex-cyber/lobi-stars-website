// Lobi Stars FC Live (white-label commentary) tests.
//
// Unit tests run anywhere. The HTTP tests need the local Pages dev server; the
// relay tests also need a test origin, e.g. a public HTTPS radio stream:
//   npx wrangler pages dev dist --port 8790 --binding FANS_DEV_LINKS=1 ADMIN_CODE=test-code-123 \
//     SESSION_SECRET=local-test-secret PARTNER_ORIGIN_STREAM_URL=https://stream.radioparadise.com/mp3-128
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isOurDomain, relayHeaders, rewritePlaylist, encodeToken, decodeToken, commentaryWindow, commentaryState, RELAY_PATH,
} from '../functions/api/_lib/commentary.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIN = 60_000;

// ── Unit tests ──

test('only Lobi Stars addresses are accepted for the stream', () => {
  assert.equal(isOurDomain('https://stream.lobistarsfc.com/live'), true);
  assert.equal(isOurDomain('https://lobistarsfc.com/live/commentary'), true);
  assert.equal(isOurDomain('/live/commentary'), true);
  assert.equal(isOurDomain('http://stream.lobistarsfc.com/live'), false, 'https only');
  assert.equal(isOurDomain('https://www.aesonsports.com/podcast'), false);
  assert.equal(isOurDomain('https://lobistarsfc.com.evil.example/live'), false);
  assert.equal(isOurDomain('/admin'), false);
});

test('relay headers drop partner-identifying headers and brand the stream', () => {
  const h = relayHeaders(new Headers({
    'Content-Type': 'audio/mpeg', Server: 'openresty', 'icy-name': 'Partner Radio', 'icy-url': 'https://partner.example',
    'icy-description': 'Partner', 'icy-genre': 'Sport', 'ice-audio-info': 'x', 'Access-Control-Allow-Origin': '*', 'Set-Cookie': 'a=b', Via: 'partner-cdn',
  }));
  assert.equal(h.get('content-type'), 'audio/mpeg');
  assert.equal(h.get('icy-name'), 'Lobi Stars FC Live');
  for (const k of ['server', 'icy-genre', 'ice-audio-info', 'access-control-allow-origin', 'set-cookie', 'via']) assert.equal(h.get(k), null, k);
  assert.doesNotMatch([...h.values()].join(' '), /partner/i);
});

test('HLS playlists are rewritten so every address goes through our relay, as opaque tokens', async () => {
  const env = { SESSION_SECRET: 'unit-test' };
  const playlist = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.partner.example/key.bin"\n#EXTINF:6.0,\nseg001.aac\n#EXTINF:6.0,\nhttps://cdn.partner.example/live/seg002.aac\n';
  const out = await rewritePlaylist(playlist, 'https://origin.partner.example/live/index.m3u8', u => encodeToken(env, u));
  assert.doesNotMatch(out, /partner\.example/);
  const uris = out.split('\n').filter(l => l && !l.startsWith('#'));
  assert.equal(uris.length, 2);
  for (const u of uris) assert.ok(u.startsWith(`${RELAY_PATH}/x/`));
  assert.match(out, new RegExp(`URI="${RELAY_PATH}/x/`));
  assert.equal(await decodeToken(env, uris[0].split('/x/')[1]), 'https://origin.partner.example/live/seg001.aac');
  assert.equal(await decodeToken(env, 'tampered-token'), null);
  assert.equal(await decodeToken({ SESSION_SECRET: 'other' }, uris[0].split('/x/')[1]), null, 'tokens only work with our secret');
});

test('commentary window: 15 min before kick-off until 15 min after full time', () => {
  const ko = Date.parse('2026-10-23T15:30:00Z');
  const base = { event_date: new Date(ko).toISOString(), status: 'scheduled' };
  assert.deepEqual(commentaryWindow(base).start, ko - 15 * MIN);
  assert.equal(commentaryWindow({ ...base, commentary_start_at: new Date(ko - 30 * MIN).toISOString() }).start, ko - 30 * MIN);
  assert.equal(commentaryWindow({ ...base, status: 'full-time', ended_at: new Date(ko + 110 * MIN).toISOString() }).end, ko + 125 * MIN);
  assert.equal(commentaryWindow({ ...base, commentary_enabled: 0 }), null);
  assert.equal(commentaryWindow({ ...base, status: 'postponed' }), null);
  // Off air before, live inside, "today" earlier in the day, off afterwards.
  const rows = [{ ...base, id: 'a' }];
  assert.equal(commentaryState(rows, ko - 16 * MIN).state, 'today');
  assert.equal(commentaryState(rows, ko - 14 * MIN).state, 'live');
  assert.equal(commentaryState(rows, ko - 3 * 24 * 60 * MIN).state, 'off');
  const done = [{ ...base, id: 'a', status: 'full-time', ended_at: new Date(ko + 100 * MIN).toISOString() }];
  assert.equal(commentaryState(done, ko + 114 * MIN).state, 'live', 'still on air 14 minutes after full time');
  assert.equal(commentaryState(done, ko + 116 * MIN).state, 'off');
});

// ── HTTP tests (local server) ──

async function adminState() { return fetch(`${BASE}/api/admin/commentary`, { headers: ADMIN }).then(r => r.json()); }
async function liveMatch() {
  const res = await fetch(`${BASE}/api/admin/events`, { method: 'POST', headers: ADMIN, body: JSON.stringify({
    home_team: 'Lobi Stars FC', away_team: `Commentary Test ${Math.random().toString(36).slice(2, 8)}`, competition: 'NNL Conference D',
    venue: 'McCarthy Stadium, Makurdi', event_date: new Date(Date.now() + 5 * MIN).toISOString(),
    vip_price_kobo: 0, premium_price_kobo: 0, regular_price_kobo: 0, active: true,
  }) });
  return (await res.json()).id;
}
async function waitFor(pred, ms = 20000) {
  const end = Date.now() + ms;
  let d;
  while (Date.now() < end) { d = await fetch(`${BASE}/api/commentary`).then(r => r.json()); if (pred(d)) return d; await sleep(1000); }
  return d;
}

test('settings refuse stream addresses that are not on lobistarsfc.com', async () => {
  for (const streamUrl of ['https://www.aesonsports.com/podcast', 'http://stream.lobistarsfc.com/live', 'https://example.com/live']) {
    const r = await fetch(`${BASE}/api/admin/commentary`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ enabled: true, streamUrl }) });
    assert.equal(r.status, 400, streamUrl);
  }
  assert.equal((await fetch(`${BASE}/api/admin/commentary`)).status, 401, 'admin only');
});

test('off air or switched off: no stream address is handed out and the relay refuses', async () => {
  const s = await adminState();
  if (!s.relayConfigured) return; // needs PARTNER_ORIGIN_STREAM_URL on the test server
  await fetch(`${BASE}/api/admin/commentary`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ enabled: false, streamUrl: '', backupUrl: '', maxListeners: 50 }) });
  const off = await waitFor(d => d.state === 'off');
  assert.equal(off.state, 'off');
  assert.equal(off.streamUrl, null);
  assert.equal((await fetch(`${BASE}/live/commentary`)).status, 503);
  await fetch(`${BASE}/api/admin/commentary`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ enabled: true, streamUrl: '', backupUrl: '', maxListeners: 50 }) });
});

test('during a match: stream on our domain, partner headers replaced, listeners counted', async () => {
  const s = await adminState();
  if (!s.relayConfigured) return;
  await liveMatch();
  const d = await waitFor(x => x.state === 'live' && x.streamUrl);
  assert.equal(d.state, 'live');
  assert.equal(d.streamUrl, '/live/commentary');
  assert.ok(isOurDomain(d.streamUrl));

  // The relay caches settings for up to 15 seconds, so a switch-on can take that long to reach it.
  let ctrl, res;
  for (let i = 0; i < 20; i++) {
    ctrl = new AbortController();
    res = await fetch(`${BASE}${d.streamUrl}`, { signal: ctrl.signal });
    if (res.status === 200) break;
    ctrl.abort(); await sleep(1000);
  }
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /audio|mpegurl/);
  assert.equal(res.headers.get('icy-name'), 'Lobi Stars FC Live');
  assert.equal(res.headers.get('server'), null);
  const reader = res.body.getReader();
  let bytes = 0;
  while (bytes < 20000) { const { value, done } = await reader.read(); if (done) break; bytes += value.length; }
  ctrl.abort();
  assert.ok(bytes >= 20000, 'audio is flowing');

  const sid = `test${Date.now()}`;
  const hb = await fetch(`${BASE}/api/commentary/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid }) }).then(r => r.json());
  assert.equal(hb.state, 'live');
  const after = await adminState();
  assert.ok(after.listeners >= 1, 'listener counted');
  assert.ok(after.peak >= 1);
});

test('the commentary pages and API never mention the partner or reveal its address', async () => {
  const s = await adminState();
  for (const path of ['/commentary/', '/commentary/mini/', '/api/commentary']) {
    const body = await fetch(`${BASE}${path}`).then(r => r.text());
    assert.doesNotMatch(body, /aeson/i, path);
    assert.doesNotMatch(body, /radioparadise|partner_origin/i, path);
  }
  const html = await fetch(`${BASE}/commentary/`).then(r => r.text());
  assert.match(html, /<title>Live Match Commentary \| Lobi Stars FC<\/title>/);
  assert.match(html, /og:image" content="https:\/\/lobistarsfc\.com\/images\/og-commentary\.jpg/);
  assert.ok(s.settings, 'admin state loads');
});

test('Broadcast Report CSV', async () => {
  const r = await fetch(`${BASE}/api/admin/broadcast-report?range=30d`, { headers: ADMIN });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Match,Kick-off \(WAT\),Listens \(plays\),Unique listeners,Average listening time \(minutes\),Peak concurrent listeners/);
});

test('persistent player: now-playing bar with Stop on public pages; in-page navigation never on admin pages', async () => {
  const home = await fetch(`${BASE}/fixtures/`).then(r => r.text());
  assert.match(home, /<meta name="astro-view-transitions-enabled"/);
  const bar = home.match(/<div[^>]*id="lsLiveBar"[^>]*>/)?.[0] || '';
  assert.match(bar, /data-astro-transition-persist/);
  assert.match(home, /data-lbar-stop/);
  const player = await fetch(`${BASE}/commentary/`).then(r => r.text());
  assert.match(player, /data-lp-stop/);
  for (const path of ['/admin/members/', '/commentary/mini/']) {
    const html = await fetch(`${BASE}${path}`).then(r => r.text());
    assert.doesNotMatch(html, /<meta name="astro-view-transitions-enabled"/, path);
    assert.doesNotMatch(html, /id="lsLiveBar"/, path);
  }
});
