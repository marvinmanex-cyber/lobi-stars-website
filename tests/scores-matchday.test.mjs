// Score verification, Phase 2, on the server: Other Games (staff report,
// official and verified results, withdraw), club network submitters (link and
// PIN, sending, the same person counts once, revoke, wrong-PIN limit) and the
// points adjustment "official reference".
// Needs the local Pages dev server with ADMIN_CODE=test-code-123.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 8);
const sql = command => {
  const file = path.join(tmpdir(), `scores-md-test-${uid()}.sql`);
  writeFileSync(file, command);
  try { execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--file', `"${file}"`], { stdio: 'pipe', shell: true }); }
  finally { rmSync(file, { force: true }); }
};
const TAG = `zz${uid()}`;
const call = (p, method = 'GET', body, h = ADMIN) => fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const pub = (body, ip) => call('/api/scores/submit', 'POST', body, { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip || `10.9.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}` });
let fixture, restoreKickoff = null, baseReport = 1e12;
const cleanup = [];
after(() => {
  sql(`DELETE FROM score_reports WHERE fixture_id = ${fixture?.id || 0} AND id > ${baseReport};
       DELETE FROM score_decisions WHERE reason LIKE '%${TAG}%';
       DELETE FROM score_submitters WHERE club LIKE '%${TAG}%';
       DELETE FROM league_table_adjustments WHERE reason LIKE '%${TAG}%';
       ${cleanup.join('\n')}`);
  if (restoreKickoff) sql(`UPDATE league_fixtures SET kickoff_at = '${restoreKickoff.at}' WHERE id = ${restoreKickoff.id};`);
});

test('Other Games: every match of the round as a card; a staff report shows as one source', async () => {
  const v = await call('/api/admin/scores/matchday');
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.ok(v.data.rounds.length && v.data.cards.length, 'rounds and cards');
  fixture = v.data.cards[0];
  assert.ok(fixture.home?.name && fixture.away?.name);
  baseReport = Math.max(0, ...(await call(`/api/admin/scores/reports?fixture=${fixture.id}`)).data.reports.map(r => r.id));
  const r = await call('/api/admin/scores/matchday', 'POST', { action: 'entry', fixtureId: fixture.id, homeGoals: 1, awayGoals: 0, status: 'LIVE', minute: '30', note: TAG });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await call('/api/admin/scores/matchday', 'POST', { action: 'entry', fixtureId: fixture.id, homeGoals: -1, awayGoals: 0, status: 'LIVE' })).status, 400);
  const card = (await call(`/api/admin/scores/matchday?round=${v.data.round}`)).data.cards.find(c => c.id === fixture.id);
  assert.ok(card.reports.length >= 1);
  assert.ok(['single', 'agreed', 'conflict'].includes(card.agreement));
  assert.equal((await call('/api/admin/scores/matchday', 'POST', { action: 'entry', fixtureId: fixture.id, homeGoals: 1, awayGoals: 0, status: 'LIVE' }, { ...ADMIN, Origin: 'https://evil.example' })).status, 403);
});

test('official result needs a note, verified result needs a reason; official wins; withdraw works', async () => {
  assert.equal((await call('/api/admin/scores/matchday', 'POST', { action: 'official', fixtureId: fixture.id, homeGoals: 2, awayGoals: 1, status: 'FULL_TIME', note: '' })).status, 400);
  assert.equal((await call('/api/admin/scores/matchday', 'POST', { action: 'verify', fixtureId: fixture.id, homeGoals: 2, awayGoals: 1, status: 'FULL_TIME', reason: 'x' })).status, 400);
  const v = await call('/api/admin/scores/matchday', 'POST', { action: 'verify', fixtureId: fixture.id, homeGoals: 3, awayGoals: 1, status: 'FULL_TIME', reason: `Checked with both clubs ${TAG}` });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  let card = (await call('/api/admin/scores/matchday')).data.cards.find(c => c.id === fixture.id) || (await call(`/api/admin/scores/matchday?round=${fixture.round || ''}`)).data.cards.find(c => c.id === fixture.id);
  const find = async () => {
    const all = (await call('/api/admin/scores/matchday')).data;
    for (const r of [all.round, ...all.rounds]) { const c = (await call(`/api/admin/scores/matchday?round=${r}`)).data.cards.find(x => x.id === fixture.id); if (c) return c; }
  };
  card = card || await find();
  assert.equal(card.confirmed.home_goals, 3, 'the verified result is the confirmed score');
  const o = await call('/api/admin/scores/matchday', 'POST', { action: 'official', fixtureId: fixture.id, homeGoals: 2, awayGoals: 1, status: 'FULL_TIME', note: `NNL website ${TAG}` });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  card = await find();
  assert.equal(card.confirmed.home_goals, 2, 'the official result wins over a verified one');
  const official = card.decisions.find(d => d.kind === 'OFFICIAL' && d.active);
  assert.equal((await call('/api/admin/scores/matchday', 'POST', { action: 'withdraw', decisionId: official.id, reason: '' })).status, 400, 'a reason is needed');
  assert.equal((await call('/api/admin/scores/matchday', 'POST', { action: 'withdraw', decisionId: official.id, reason: `Entered by mistake ${TAG}` })).status, 200);
  card = await find();
  assert.equal(card.confirmed.home_goals, 3, 'back to the verified result');
  for (const d of card.decisions.filter(x => x.active)) await call('/api/admin/scores/matchday', 'POST', { action: 'withdraw', decisionId: d.id, reason: `Test finished ${TAG}` });
});

test('club network: link and PIN shown once; sending works; the same person counts once; revoke stops them', async () => {
  // Make the fixture "today" so it shows on the form.
  const fx = (await call('/api/admin/league/fixtures')).data;
  const row = (fx.fixtures || fx.items || []).find(f => f.id === fixture.id);
  restoreKickoff = { id: fixture.id, at: row.kickoff_at };
  sql(`UPDATE league_fixtures SET kickoff_at = '${new Date(Date.now() - 30 * 60e3).toISOString()}' WHERE id = ${fixture.id};`);

  assert.equal((await call('/api/admin/scores/submitters', 'POST', { action: 'add', name: 'A', club: '' })).status, 400);
  const add = await call('/api/admin/scores/submitters', 'POST', { action: 'add', name: 'Musa Test', club: `Kada ${TAG}`, phone: '0800 000 0000' });
  assert.equal(add.status, 200, JSON.stringify(add.data));
  assert.match(add.data.pin, /^\d{8}$/);
  assert.match(add.data.link, /\/scores\/submit\/\?t=[\w-]{20,}$/);
  const t = add.data.token;
  const list = (await call('/api/admin/scores/submitters')).data.submitters.find(s => s.id === add.data.id);
  assert.ok(list && !('token_hash' in list) && !('pin_hash' in list), 'secrets never listed');

  const open = await pub({ action: 'open', t });
  assert.equal(open.status, 200, JSON.stringify(open.data));
  assert.equal(open.data.submitter.name, 'Musa Test');
  assert.ok(open.data.fixtures.some(f => f.id === fixture.id), 'today\'s match offered');
  assert.equal((await pub({ action: 'open', pin: add.data.pin })).status, 200, 'the PIN works too');

  assert.equal((await pub({ action: 'send', t, fixtureId: fixture.id, homeGoals: 0, awayGoals: 0, status: 'LIVE', minute: '5' })).status, 200);
  assert.equal((await pub({ action: 'send', t, fixtureId: fixture.id, homeGoals: 1, awayGoals: 0, status: 'HALF_TIME' })).status, 200);
  assert.equal((await pub({ action: 'send', t, fixtureId: fixture.id, homeGoals: 1, awayGoals: 0, status: 'WON' })).status, 400);
  const d = (await call(`/api/admin/scores/reports?fixture=${fixture.id}`)).data;
  const mine = d.latest.filter(x => x.source_identity === `submitter:${add.data.id}`);
  assert.equal(mine.length, 1, 'the same submitter counts once');
  assert.equal(mine[0].status, 'HALF_TIME', 'their latest report is used');
  cleanup.push(`DELETE FROM score_reports WHERE source_identity = 'submitter:${add.data.id}';`);

  const renew = await call('/api/admin/scores/submitters', 'POST', { action: 'renew', id: add.data.id });
  assert.equal(renew.status, 200);
  assert.equal((await pub({ action: 'open', t })).status, 403, 'the old link stops working');
  assert.equal((await pub({ action: 'open', t: renew.data.token })).status, 200);
  assert.equal((await call('/api/admin/scores/submitters', 'POST', { action: 'revoke', id: add.data.id })).status, 200);
  assert.equal((await pub({ action: 'open', t: renew.data.token })).status, 403, 'removed: link stops working');
  assert.equal((await pub({ action: 'open', pin: renew.data.pin })).status, 403);
});

test('wrong links and PINs are limited per connection', async () => {
  const ip = `10.77.${(Math.random() * 250) | 0}.9`;
  let last;
  for (let i = 0; i < 12; i++) last = await pub({ action: 'open', pin: String(10000000 + i) }, ip);
  assert.equal(last.status, 429);
});

test('points adjustments keep an official reference and show it in the public table note', async () => {
  const table = (await call('/api/admin/league/table')).data;
  const team = table.teams[0];
  const r = await call('/api/admin/league/adjustments', 'POST', { teamId: team.id, points: -3, reason: `Ineligible player ${TAG}`, officialRef: 'NNL letter 12/2026' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const list = (await call('/api/admin/league/adjustments')).data.adjustments;
  assert.equal(list.find(a => a.id === r.data.id).official_ref, 'NNL letter 12/2026');
  const pubTable = await fetch(`${BASE}/api/league/table`).then(x => x.json()).catch(() => ({}));
  assert.ok(JSON.stringify(pubTable).includes('NNL letter 12/2026'), 'footnote on the public table');
  assert.equal((await call(`/api/admin/league/adjustments/${r.data.id}/void`, 'POST', { reason: `Test finished ${TAG}` })).status, 200);
});
