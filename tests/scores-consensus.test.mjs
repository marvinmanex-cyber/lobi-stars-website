// Score verification, Phase 4, on the server: two sources agree → the table
// uses the result; one source → no change; a disagreement becomes a conflict
// after the grace window (bell); accepting a score; an official correction
// recalculates the table; the missing-result reminder; League › Results still
// updates the table (as a verified result).
// Needs the local Pages dev server with ADMIN_CODE=test-code-123,
// CRON_SECRET=cron-test-secret and FANS_DEV_LINKS=1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const CRON = { Authorization: `Bearer ${process.env.CRON_SECRET || 'cron-test-secret'}` };
const uid = () => Math.random().toString(36).slice(2, 8);
const sql = command => {
  const file = path.join(tmpdir(), `scores-cons-test-${uid()}.sql`);
  writeFileSync(file, command);
  try { execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--file', `"${file}"`], { stdio: 'pipe', shell: true }); }
  finally { rmSync(file, { force: true }); }
};
const TAG = `zz${uid()}`;
const call = (p, method = 'GET', body, h = ADMIN) => fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const md = body => call('/api/admin/scores/matchday', 'POST', body);
const paste = (sub, text) => call('/api/admin/scores/messages', 'POST', { action: 'paste', from: `submitter:${sub}`, text });
const run = now => fetch(`${BASE}/api/internal/scores-run?now=${encodeURIComponent(new Date(now).toISOString())}`, { method: 'POST', headers: CRON }).then(r => r.json());
const q = s => `'${String(s).replace(/'/g, "''")}'`;

let F = [], saved = [], sub1, sub2;
const card = async id => {
  const v = (await call(`/api/admin/scores/matchday?fixture=${id}`)).data;
  return v.cards.find(c => c.id === id);
};
const fixture = async id => (await call('/api/admin/league/fixtures')).data.fixtures.find(f => f.id === id);
const played = async teamId => (await call('/api/admin/league/table')).data.rows.find(r => r.team.id === teamId)?.played ?? 0;

before(async () => {
  const all = (await call('/api/admin/league/fixtures')).data.fixtures.filter(f => !f.eventId && f.status === 'scheduled' && f.homeGoals === null);
  // Five matches between ten different clubs if possible, so table checks don't overlap.
  const used = new Set();
  for (const f of all) { if (F.length >= 5) break; if (used.has(f.home.id) || used.has(f.away.id)) continue; used.add(f.home.id); used.add(f.away.id); F.push(f); }
  while (F.length < 5) F.push(all.find(f => !F.includes(f)));
  saved = F.map(f => ({ id: f.id, kickoff: f.kickoff }));
  const now = Date.now();
  sql(F.map((f, i) => `UPDATE league_fixtures SET kickoff_at = ${q(new Date(now - (i === 4 ? 180 : 100) * 60e3).toISOString())} WHERE id = ${f.id};`).join('\n'));
  sub1 = (await call('/api/admin/scores/submitters', 'POST', { action: 'add', name: 'One', club: `A ${TAG}` })).data.id;
  sub2 = (await call('/api/admin/scores/submitters', 'POST', { action: 'add', name: 'Two', club: `B ${TAG}` })).data.id;
});
after(() => {
  const ids = F.map(f => f.id).join(',') || '0';
  sql(`DELETE FROM score_reports WHERE fixture_id IN (${ids}); DELETE FROM score_decisions WHERE fixture_id IN (${ids}); DELETE FROM score_state WHERE fixture_id IN (${ids});
       DELETE FROM score_alerts WHERE key LIKE '%:${F[0]?.id}:%' OR key LIKE 'missing:%';
       DELETE FROM score_messages WHERE body LIKE '%${TAG}%';
       DELETE FROM score_submitters WHERE club LIKE '%${TAG}%';
       ${saved.map(s => `UPDATE league_fixtures SET kickoff_at = ${q(s.kickoff)}, status = 'scheduled', home_goals = NULL, away_goals = NULL, result_type = 'normal', verification = NULL WHERE id = ${s.id};`).join('\n')}`);
});

test('one source: unconfirmed, the table does not change', async () => {
  const f = F[1];
  const p0 = await played(f.home.id);
  const r = await md({ action: 'entry', fixtureId: f.id, homeGoals: 3, awayGoals: 0, status: 'FULL_TIME' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.state, 'UNCONFIRMED');
  const fx = await fixture(f.id);
  assert.equal(fx.homeGoals, null, 'not written to the fixture (show unconfirmed is off)');
  assert.equal(await played(f.home.id), p0);
  assert.equal((await card(f.id)).agreement, 'single');
});

test('two independent sources agree: confirmed, the table uses it', async () => {
  const f = F[0];
  const p0 = await played(f.home.id);
  await md({ action: 'entry', fixtureId: f.id, homeGoals: 2, awayGoals: 1, status: 'FULL_TIME' });
  const r = await paste(sub1, `FT ${f.home.name} 2-1 ${f.away.name}
${TAG}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const c = await card(f.id);
  assert.equal(c.state, 'CONFIRMED', c.explanation);
  assert.equal(c.agreement, 'agreed');
  const fx = await fixture(f.id);
  assert.deepEqual([fx.status, fx.homeGoals, fx.awayGoals], ['full_time', 2, 1]);
  assert.equal(await played(f.home.id), p0 + 1);
  const hist = (await call(`/api/admin/league/audit?entity=fixture&id=${f.id}`)).data;
  assert.match(JSON.stringify(hist), /confirmed/i, 'logged in plain English');
});

test('the same submitter twice still counts once', async () => {
  const f = F[1];
  await paste(sub2, `FT ${f.home.name} 1-1 ${f.away.name}
${TAG}`);
  await paste(sub2, `FT ${f.home.name} 1-1 ${f.away.name}
again ${TAG}`);
  assert.notEqual((await card(f.id)).state, 'CONFIRMED');
});

test('sources disagree: waits the grace window, then a conflict on the bell; "accept this score" resolves it', async () => {
  const f = F[2];
  await md({ action: 'entry', fixtureId: f.id, homeGoals: 1, awayGoals: 0, status: 'FULL_TIME' });
  await paste(sub1, `FT ${f.home.name} 0-0 ${f.away.name}
${TAG}`);
  assert.equal((await card(f.id)).state, 'PENDING', 'within the grace window');
  await run(Date.now() + 4 * 60e3);
  const c = await card(f.id);
  assert.equal(c.state, 'CONFLICT');
  assert.ok((await call('/api/admin/notifications')).data.items.some(i => /score conflict/.test(i.title)), 'bell');
  const p0 = await played(f.home.id);
  const pick = c.reports.find(r => r.latest && r.home_goals === 1);
  const v = await md({ action: 'verify', fixtureId: f.id, homeGoals: pick.home_goals, awayGoals: pick.away_goals, status: pick.status, reason: 'Sources disagreed; accepted the staff score' });
  assert.equal(v.data.state, 'VERIFIED');
  assert.equal(await played(f.home.id), p0 + 1, 'counts after the decision');
});

test('an official correction replaces a confirmed result and the table is worked out again', async () => {
  const f = F[0];
  const r = await md({ action: 'official', fixtureId: f.id, homeGoals: 0, awayGoals: 3, status: 'AWARDED', note: 'NNL ruling: awarded to the away side' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.state, 'OFFICIAL');
  const fx = await fixture(f.id);
  assert.deepEqual([fx.status, fx.homeGoals, fx.awayGoals], ['awarded', 0, 3]);
  const row = (await call('/api/admin/league/table')).data.rows.find(x => x.team.id === f.away.id);
  assert.ok(row.won >= 1);
});

test('missing result: kick-off + 115 minutes without a confirmed final score → reminder on the bell', async () => {
  const out = await run(Date.now());
  assert.ok(out.missing >= 1, JSON.stringify(out));
  assert.ok((await call('/api/admin/notifications')).data.items.some(i => /without a confirmed result/.test(i.title)));
});

test('League › Results still updates the table (as a verified result)', async () => {
  const f = await fixture(F[3].id);
  const p0 = await played(f.home.id);
  const r = await call(`/api/admin/league/results/matchday/${f.matchday}`, 'PUT', { rows: [{ id: f.id, status: 'full_time', homeGoals: 1, awayGoals: 1 }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await played(f.home.id), p0 + 1);
  assert.equal((await card(f.id)).state, 'VERIFIED');
});

test('Commentary Assist webhook refuses without its secret', async () => {
  const r = await fetch(`${BASE}/api/scores/commentary`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' }, body: '{}' });
  assert.ok([403, 503].includes(r.status));
  assert.equal((await fetch(`${BASE}/api/internal/scores-run`, { method: 'POST' })).status, 403);
});
