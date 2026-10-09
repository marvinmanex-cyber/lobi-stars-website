// Phase 8: rules/terms/privacy pages, reminder emails and the away-game rule.
// Needs the local Pages dev server with FANS_DEV_LINKS=1 and
// ADMIN_CODE=test-code-123 (see tests/fans.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 10);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function match(kickoffInMs, over = {}) {
  const res = await fetch(`${BASE}/api/admin/events`, {
    method: 'POST', headers: ADMIN, body: JSON.stringify({
      home_team: 'Lobi Stars FC', away_team: `Extras Test ${uid()}`, competition: 'NNL Conference D',
      venue: 'McCarthy Stadium, Makurdi', event_date: new Date(Date.now() + kickoffInMs).toISOString(),
      vip_price_kobo: 0, premium_price_kobo: 0, regular_price_kobo: 0, active: true, ...over,
    }),
  });
  const { id } = await res.json();
  return (await fetch(`${BASE}/api/admin/match-centre/${id}`, { headers: ADMIN }).then(r => r.json())).match;
}

test('Predict & Win terms and MOTM rules pages exist; terms are marked DRAFT and kept out of search', async () => {
  const terms = await fetch(`${BASE}/predict-and-win/terms/`);
  assert.equal(terms.status, 200);
  const t = await terms.text();
  assert.match(t, /DRAFT/);
  assert.match(t, /legal adviser/);
  assert.match(t, /name="robots" content="noindex/);
  for (const s of ['₦10,000', '18 or older', 'resident in Nigeria', 'One entry per person per home game', '24 hours before the scheduled kick-off', 'received first', 'prize is not given out', 'families', 'decision on all matters', 'never ask for your password']) {
    assert.ok(t.includes(s), `terms mention: ${s}`);
  }
  const rules = await fetch(`${BASE}/motm/rules/`);
  assert.equal(rules.status, 200);
  const r = await rules.text();
  assert.match(r, /One vote per account per match/);
  assert.match(r, /opens at kick-off/);
});

test('Privacy Policy covers fan accounts, voting, predictions and marketing', async () => {
  const html = await fetch(`${BASE}/privacy/`).then(r => r.text());
  for (const s of ['Create a fan account', 'Vote for Man of the Match', 'Play Predict &amp; Win', 'unsubscribe', 'Nigeria Data Protection Act', 'IP addresses']) {
    assert.ok(html.includes(s), `privacy mentions: ${s}`);
  }
});

test('reminder emails go once, only to opted-in verified fans (recorded in test mode)', async () => {
  // A fan who said yes to news and offers.
  const email = `notify-${uid()}@example.com`;
  const reg = await fetch(`${BASE}/api/fans/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({
    firstName: 'Opt', surname: 'In', email, confirmEmail: email, phone: `0813${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`,
    password: 'Lobi-Stars-2026', confirmPassword: 'Lobi-Stars-2026', agree: true, marketing: true,
  }) }).then(r => r.json());
  await fetch(reg.devLink.replace('https://lobistarsfc.com', BASE), { redirect: 'manual' });

  const m = await match(2 * 3600e3); // inside the 24h prediction window
  await fetch(`${BASE}/api/matches`); await fetch(`${BASE}/api/matches`);
  let notes = [];
  for (let i = 0; i < 10 && !notes.length; i++) {
    await sleep(400);
    notes = (await fetch(`${BASE}/api/admin/predictions/${m.id}`, { headers: ADMIN }).then(r => r.json())).notifications;
  }
  const open = notes.find(n => n.kind === 'predictions_open');
  assert.ok(open, 'predictions_open reminder recorded');
  assert.equal(open.status, 'dev');
  assert.ok(open.recipients >= 1);
  assert.equal(notes.filter(n => n.kind === 'predictions_open').length, 1, 'only once');

  await fetch(`${BASE}/api/admin/match-centre/${m.id}`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ action: 'kickoff' }) });
  let kick;
  for (let i = 0; i < 10 && !kick; i++) {
    await sleep(400);
    kick = (await fetch(`${BASE}/api/admin/predictions/${m.id}`, { headers: ADMIN }).then(r => r.json())).notifications.find(n => n.kind === 'kickoff');
  }
  assert.ok(kick, 'kick-off reminder recorded');
  await fetch(`${BASE}/api/admin/match-centre/${m.id}`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ action: 'fulltime', home_score: 0, away_score: 0 }) });
});

test('away games: no stream, voting or predictions (commentary only), and no reminders', async () => {
  const m = await match(2 * 3600e3, { home_team: 'Sokoto United FC', away_team: 'Lobi Stars FC' });
  const { match: pub } = await fetch(`${BASE}/api/matches/${m.slug}`).then(r => r.json());
  assert.equal(pub.is_home, false);
  assert.deepEqual(pub.stream, { youtube: null, facebook: null });
  assert.equal((await fetch(`${BASE}/api/matches/${m.slug}/motm`)).status, 404);
  assert.equal((await fetch(`${BASE}/api/matches/${m.slug}/predict`)).status, 404);
  assert.equal((await fetch(`${BASE}/matches/${m.slug}/live/`, { redirect: 'manual' })).status, 302);
  await fetch(`${BASE}/api/matches`);
  await sleep(800);
  const notes = (await fetch(`${BASE}/api/admin/predictions/${m.id}`, { headers: ADMIN }).then(r => r.json())).notifications;
  assert.equal(notes.length, 0);
});

test('/motm redirects to the Man of the Match page', async () => {
  const res = await fetch(`${BASE}/motm`, { redirect: 'manual' });
  assert.equal(res.status, 301);
  assert.match(res.headers.get('location'), /\/man-of-the-match\/$/);
});
