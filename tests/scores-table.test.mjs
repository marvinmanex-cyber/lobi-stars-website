// Score verification, Phase 5, on the server: the live provisional table
// (arrows since kick-off), the mini scoreboard on /table, the mini table on the
// homepage and Matchday Live, and the table saved after each completed round
// (a new version after a correction).
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
  const file = path.join(tmpdir(), `scores-table-test-${uid()}.sql`);
  writeFileSync(file, command);
  try { execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--file', `"${file}"`], { stdio: 'pipe', shell: true }); }
  finally { rmSync(file, { force: true }); }
};
const TAG = `zz${uid()}`;
const call = (p, method = 'GET', body, h = ADMIN) => fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const run = () => fetch(`${BASE}/api/internal/scores-run`, { method: 'POST', headers: CRON }).then(r => r.json());
const q = s => `'${String(s).replace(/'/g, "''")}'`;

let round = [], md, comp, saved = [], sub;
before(async () => {
  const d = (await call('/api/admin/league/fixtures')).data;
  comp = d.competition;
  const byMd = new Map();
  for (const f of d.fixtures) if (f.matchday) byMd.set(f.matchday, [...(byMd.get(f.matchday) || []), f]);
  [md, round] = [...byMd.entries()].find(([, list]) => list.every(f => f.status === 'scheduled' && f.homeGoals === null));
  saved = round.map(f => ({ id: f.id, kickoff: f.kickoff }));
  const now = Date.now();
  sql(`${round.map(f => `UPDATE league_fixtures SET kickoff_at = ${q(new Date(now - 30 * 60e3).toISOString())} WHERE id = ${f.id};`).join('\n')}
       UPDATE league_competitions SET include_live = 1 WHERE id = ${comp.id};
       CREATE TABLE IF NOT EXISTS league_table_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, competition_id INTEGER NOT NULL, matchday INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, rows_json TEXT NOT NULL, hash TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL);
       DELETE FROM league_table_snapshots WHERE competition_id = ${comp.id} AND matchday = ${md};`);
  sub = (await call('/api/admin/scores/submitters', 'POST', { action: 'add', name: 'Table test', club: `T ${TAG}` })).data.id;
});
after(async () => {
  // Back to "not played" through League › Results, so Live Match Control is reset for our own match too.
  if (md) await call(`/api/admin/league/results/matchday/${md}`, 'PUT', { rows: round.map(f => ({ id: f.id, status: 'scheduled' })) });
  const ids = round.map(f => f.id).join(',') || '0';
  sql(`DELETE FROM score_reports WHERE fixture_id IN (${ids}); DELETE FROM score_decisions WHERE fixture_id IN (${ids}); DELETE FROM score_state WHERE fixture_id IN (${ids});
       DELETE FROM score_messages WHERE body LIKE '%${TAG}%'; DELETE FROM score_submitters WHERE club LIKE '%${TAG}%';
       DELETE FROM league_table_snapshots WHERE competition_id = ${comp?.id || 0} AND matchday = ${md || 0};
       UPDATE league_competitions SET include_live = 0 WHERE id = ${comp?.id || 0};
       ${saved.map(s => `UPDATE league_fixtures SET kickoff_at = ${q(s.kickoff)}, status = 'scheduled', home_goals = NULL, away_goals = NULL, result_type = 'normal', verification = NULL WHERE id = ${s.id};`).join('\n')}`);
});

test('live table: a confirmed live score counts as it stands, with arrows since kick-off; /table shows the scoreboard', async () => {
  const f = round.find(x => !x.eventId);
  const before = (await call('/api/league/table')).data;
  const posBefore = before.rows.find(r => r.team.id === f.away.id).pos;
  await call('/api/admin/scores/matchday', 'POST', { action: 'entry', fixtureId: f.id, homeGoals: 0, awayGoals: 2, status: 'LIVE', minute: '60' });
  await call('/api/admin/scores/messages', 'POST', { action: 'paste', from: `submitter:${sub}`, text: `${f.home.name} 0-2 ${f.away.name} 61'\n${TAG}` });
  const t = (await call('/api/league/table')).data;
  assert.equal(t.live, true, 'live table');
  const row = t.rows.find(r => r.team.id === f.away.id);
  assert.equal(row.played, 1);
  assert.equal(row.points, 3);
  if (posBefore > 1) assert.ok(row.movement > 0, `arrow up (was ${posBefore}, now ${row.pos})`);
  assert.ok(t.scoreboard.some(m => m.id === f.id && m.awayGoals === 2 && m.status === 'live'), 'scoreboard');
  const html = await (await fetch(`${BASE}/table/?z=${uid()}`)).text();
  assert.match(html, /class="lg-board"/);
  assert.match(html, /Live table/);
});

test('the homepage and Matchday Live show the mini table (same data)', async () => {
  for (const p of ['/', '/matchday-live/']) assert.match(await (await fetch(`${BASE}${p}`)).text(), /data-mini-table/, p);
});

test('a completed round is saved; a correction saves a new version', async () => {
  // Finish the round through League › Results (verified results).
  const r = await call(`/api/admin/league/results/matchday/${md}`, 'PUT', { rows: round.map((f, i) => ({ id: f.id, status: 'full_time', homeGoals: i % 3, awayGoals: 1 })) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const out = await run();
  assert.ok(out.snapshots >= 1, JSON.stringify(out));
  let snaps = (await call('/api/admin/scores/snapshots')).data.snapshots.filter(s => s.matchday === md);
  assert.equal(snaps.length, 1);
  assert.ok(snaps[0].rows.reduce((n, x) => n + x.played, 0) >= round.length * 2, 'the table after this round (earlier rounds included)');
  assert.equal((await run()).snapshots, 0, 'nothing changed: not saved again');
  await call('/api/admin/scores/matchday', 'POST', { action: 'official', fixtureId: round.find(x => !x.eventId).id, homeGoals: 5, awayGoals: 0, status: 'FULL_TIME', note: 'NNL corrected result' });
  await run();
  snaps = (await call('/api/admin/scores/snapshots')).data.snapshots.filter(s => s.matchday === md);
  assert.equal(snaps[0].version, 2);
  assert.match(snaps[0].reason, /changed/);
});
