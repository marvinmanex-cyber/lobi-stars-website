// Final-score reminder (Super Admins) and the exact-score list on Predict & Win.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './media-helpers.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const T = Date.now().toString(36);
const made = [];
const mk = async minsAgo => {
  const r = await fetch(`${BASE}/api/admin/events`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ home_team: 'Lobi Stars FC', away_team: `Reminder ${T} ${minsAgo}`, competition: 'NNL', venue: 'McCarthy', event_date: new Date(Date.now() - minsAgo * 60e3).toISOString(), vip_price_kobo: 0, premium_price_kobo: 0, regular_price_kobo: 0, active: true }) });
  const { id } = await r.json(); made.push(id); return id;
};
const due = async () => (await fetch(`${BASE}/api/admin/score-reminder`, { headers: ADMIN }).then(r => r.json())).due.map(d => d.id);

test('the reminder starts 1 h 55 min after kick-off and stops when the score is entered or dismissed', async () => {
  const soon = await mk(100), late = await mk(120), other = await mk(130);
  let d = await due();
  assert.ok(!d.includes(soon), 'not yet at 1 h 40');
  assert.ok(d.includes(late) && d.includes(other));
  // Entering the score (End Match) stops it.
  await fetch(`${BASE}/api/admin/match-centre/${late}`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ action: 'kickoff' }) });
  const ft = await fetch(`${BASE}/api/admin/match-centre/${late}`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ action: 'fulltime', home_score: 3, away_score: 1 }) });
  assert.equal(ft.status, 200, await ft.text());
  d = await due();
  assert.ok(!d.includes(late), 'score entered');
  const pr = await fetch(`${BASE}/api/matches/${late}/predict`).then(r => r.json());
  assert.equal(pr.state, 'result'); assert.ok(Array.isArray(pr.result.exact), 'the exact-score list is there');
  // Dismissing stops it too, and is logged.
  assert.equal((await fetch(`${BASE}/api/admin/score-reminder`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ action: 'dismiss', id: other }) })).status, 200);
  assert.ok(!(await due()).includes(other));
});

after(() => { if (made.length) sql(`DELETE FROM score_reminder_dismissed WHERE event_id IN (${made.map(i => `'${i}'`).join(',')}); UPDATE events SET active = 0 WHERE id IN (${made.map(i => `'${i}'`).join(',')});`); });
