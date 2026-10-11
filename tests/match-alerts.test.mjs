// Fan match alerts: fans turn on "🔔 Match alerts" (no account), and get a
// notification for kick-off, goals, half-time, second half, full time and when
// the radio show goes on air; staff can send one by hand. Each automatic alert
// goes out once per match. Needs the local Pages dev server with
// ADMIN_CODE=test-code-123, VAPID keys and CRON_SECRET=cron-test-secret.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { alertText } from '../functions/api/_lib/matchAlerts.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const CRON = process.env.CRON_SECRET || 'cron-test-secret';
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const api = (path, method = 'GET', body, headers = ADMIN) => fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const pub = (action, body) => api(`/api/push/${action}`, 'POST', body, { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b64u = buf => Buffer.from(buf).toString('base64url');
const made = [];
after(async () => {
  for (const id of made) await fetch(`${BASE}/api/admin/staff/${id}`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ active: false }) });
  await api('/api/admin/fan-alerts', 'POST', { settings: { radio_live: true, kickoff: true, halftime: true, second_half: true, fulltime: true, goal: true } });
});

/** A browser push subscription with real keys, pointing at an address that refuses connections. */
async function fakeSub() {
  const k = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { endpoint: `https://127.0.0.1:1/push/${uid()}`, keys: { p256dh: b64u(await crypto.subtle.exportKey('raw', k.publicKey)), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) } };
}
async function createMatch() {
  const r = await api('/api/admin/events', 'POST', {
    home_team: 'Lobi Stars FC', away_team: `Alert Test ${uid()}`, competition: 'NNL Conference D',
    venue: 'McCarthy Stadium, Makurdi', event_date: new Date(Date.now() + 864e5).toISOString(),
    vip_price_kobo: 0, premium_price_kobo: 0, regular_price_kobo: 0, active: true,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.id;
}
const jobsFor = async id => { await sleep(1200); return (await api('/api/admin/fan-alerts')).data.jobs.filter(j => j.event_id === id); };
const kinds = jobs => jobs.map(j => j.kind).sort();

test('alert texts', () => {
  const e = { home_team: 'Lobi Stars FC', away_team: 'Kwara United', event_date: '2026-10-18T15:00:00Z' };
  assert.equal(alertText('kickoff', e).title, '⚽ Kick-off! Lobi Stars vs Kwara United');
  assert.match(alertText('kickoff', e).url, /^\/matches\/.+\/$/);
  assert.equal(alertText('fulltime', e, { home: 2, away: 1 }).title, '🏁 Full time: Lobi Stars 2–1 Kwara United');
  assert.equal(alertText('kickoff', { home_team: 'A', away_team: 'B' }).url, '/fixtures/', 'no date: safe link');
  assert.match(alertText('radio_live', e, { preMatch: true }).title, /Pre-match show is live/);
  assert.match(alertText('radio_live', e, {}).title, /Live commentary has started/);
});

test('fans turn alerts on, check them, change choices and turn them off; bad input refused', async () => {
  const sub = await fakeSub();
  assert.equal((await fetch(`${BASE}/api/push/public-key`).then(r => r.json())).key.length > 40, true);
  assert.equal((await pub('subscribe', { subscription: { endpoint: 'http://insecure/x', keys: sub.keys } })).status, 400);
  assert.equal((await pub('subscribe', { subscription: sub, prefs: { radio: false, match: false, goals: false } })).status, 400, 'at least one');
  assert.equal((await pub('subscribe', { subscription: sub, prefs: { goals: false } })).status, 200);
  let s = (await pub('status', { endpoint: sub.endpoint })).data;
  assert.deepEqual(s, { subscribed: true, prefs: { radio: true, match: true, goals: false } });
  await pub('subscribe', { subscription: sub, prefs: { radio: true, match: false, goals: true } });
  s = (await pub('status', { endpoint: sub.endpoint })).data;
  assert.deepEqual(s.prefs, { radio: true, match: false, goals: true });
  await pub('unsubscribe', { endpoint: sub.endpoint });
  assert.equal((await pub('status', { endpoint: sub.endpoint })).data.subscribed, false);
});

test('match control sends kick-off, goal, half-time, second half and full time alerts, each once', async () => {
  await pub('subscribe', { subscription: await fakeSub(), prefs: {} });
  const id = await createMatch();
  assert.equal((await api(`/api/admin/match-centre/${id}`, 'POST', { action: 'kickoff' })).status, 200);
  assert.deepEqual(kinds(await jobsFor(id)), ['kickoff']);
  const cur = async () => (await api(`/api/admin/match-centre/${id}`)).data.match;
  const put = async over => assert.equal((await api(`/api/admin/match-centre/${id}`, 'PUT', { ...(await cur()), ...over })).status, 200);
  await put({ status: 'live', home_score: 1, away_score: 0 });
  await put({ status: 'live', home_score: 1, away_score: 0 });
  await put({ status: 'half-time', home_score: 1, away_score: 0 });
  await put({ status: 'live', home_score: 1, away_score: 0 });
  await put({ status: 'live', home_score: 1, away_score: 1 });
  assert.equal((await api(`/api/admin/match-centre/${id}`, 'POST', { action: 'fulltime', home_score: 2, away_score: 1 })).status, 200);
  const jobs = await jobsFor(id);
  assert.deepEqual(kinds(jobs), ['fulltime', 'goal', 'goal', 'halftime', 'kickoff', 'second_half']);
  const goals = jobs.filter(j => j.kind === 'goal');
  assert.ok(goals.every(j => j.category === 'goals'));
  assert.ok(goals.some(j => /GOAL for Lobi Stars/.test(j.title)), 'home goal');
  assert.ok(jobs.find(j => j.kind === 'fulltime').title.includes('2–1'));
  assert.ok(jobs.every(j => j.sent + j.failed >= 0));
});

test('switched-off automatic alerts are not sent', async () => {
  await api('/api/admin/fan-alerts', 'POST', { settings: { radio_live: true, kickoff: false, halftime: true, second_half: true, fulltime: true, goal: true } });
  const id = await createMatch();
  await api(`/api/admin/match-centre/${id}`, 'POST', { action: 'kickoff' });
  assert.deepEqual(await jobsFor(id), []);
  await api('/api/admin/fan-alerts', 'POST', { settings: { radio_live: true, kickoff: true, halftime: true, second_half: true, fulltime: true, goal: true } });
});

test('staff send an alert by hand; it reaches every signed-up device in batches (cron and run endpoint)', async () => {
  for (let i = 0; i < 3; i++) await pub('subscribe', { subscription: await fakeSub(), prefs: { radio: true } });
  const before = (await api('/api/admin/fan-alerts')).data;
  assert.ok(before.counts.radio >= 3);
  const title = `🎙️ Pre-match show starts now ${uid()}`;
  assert.equal((await api('/api/admin/fan-alerts', 'POST', { send: { category: 'radio', title: '', body: 'x' } })).status, 400, 'title required');
  assert.equal((await api('/api/admin/fan-alerts', 'POST', { send: { category: 'radio', title, body: 'Tap to listen', url: '/commentary/' } })).status, 200);
  for (let i = 0; i < 20; i++) {
    await api('/api/admin/fan-alerts/run', 'POST');
    await fetch(`${BASE}/api/internal/kitchen-repeat`, { method: 'POST', headers: { Authorization: `Bearer ${CRON}` } });
    const j = (await api('/api/admin/fan-alerts')).data.jobs.find(x => x.title === title);
    if (j.done_at) { assert.ok(j.sent + j.failed >= 3, JSON.stringify(j)); return; }
    await sleep(1000);
  }
  assert.fail('alert never finished sending');
});

test('only matchday staff manage fan alerts; the run endpoint and cron need sign-in or the secret', async () => {
  const login = async role => {
    const email = `fa-${role}-${uid()}@example.com`;
    const r = await api('/api/admin/staff', 'POST', { name: `FA ${role}`, email, password: 'Role-Test-2026!', role });
    made.push(r.data.id);
    const l = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
    return { Cookie: l.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' };
  };
  const md = await login('matchday');
  assert.equal((await api('/api/admin/fan-alerts', 'GET', null, md)).status, 200);
  assert.equal((await fetch(`${BASE}/admin/fan-alerts/`, { headers: md, redirect: 'manual' })).status, 200);
  for (const role of ['analyst', 'commercial']) {
    const h = await login(role);
    assert.equal((await api('/api/admin/fan-alerts', 'GET', null, h)).status, 403, role);
    assert.equal((await api('/api/admin/fan-alerts/run', 'POST', null, h)).status, 200, `${role} pages keep alerts moving`);
  }
  assert.equal((await api('/api/admin/fan-alerts/run', 'POST', null, { 'Content-Type': 'application/json' })).status, 401);
  assert.equal((await fetch(`${BASE}/api/internal/fan-push-run`, { method: 'POST' })).status, 403);
});

test('the service worker shows match alerts and the alert box is on match pages', async () => {
  const sw = await fetch(`${BASE}/sw.js`).then(r => r.text());
  assert.match(sw, /addEventListener\('push'/);
  assert.match(sw, /kind !== 'match'/);
  assert.match(sw, /notificationclick/);
  for (const page of ['/', '/fixtures/', '/commentary/', '/match-centre/']) {
    const html = await fetch(BASE + page).then(r => r.text());
    assert.ok(html.includes('data-match-alerts'), page);
  }
  const priv = await fetch(`${BASE}/privacy/`).then(r => r.text());
  assert.match(priv, /Turn on match alerts/);
});
