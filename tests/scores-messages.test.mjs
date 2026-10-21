// Score verification, Phase 3, on the server: WhatsApp messages pasted by
// staff and emails to scores@ are read into score reports; the original is
// kept; unknown senders and unclear messages wait for a person (approve /
// reject); Claude is only asked when the rules can't read a message.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123,
// INBOX_INBOUND_KEY=test-inbound, ANTHROPIC_API_KEY and
// ANTHROPIC_BASE_URL=http://127.0.0.1:8899/v1 (this test answers as Claude).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const INBOUND_KEY = process.env.INBOX_INBOUND_KEY || 'test-inbound';
const uid = () => Math.random().toString(36).slice(2, 8);
const sql = command => {
  const file = path.join(tmpdir(), `scores-msg-test-${uid()}.sql`);
  writeFileSync(file, command);
  try { execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--file', `"${file}"`], { stdio: 'pipe', shell: true }); }
  finally { rmSync(file, { force: true }); }
};
const TAG = `zz${uid()}`;
const call = (p, method = 'GET', body, h = ADMIN) => fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const msgs = body => call('/api/admin/scores/messages', 'POST', body);

// ── Stand-in for Claude ──
let fx, sub, restore = null, claudeCalls = 0, server, baseMsg = 0, baseReport = 0;
before(async () => {
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      claudeCalls++;
      const text = /football score messages/.test(body.system || '')
        ? JSON.stringify({ matches: [{ home: fx.home.name, away: fx.away.name, home_goals: 3, away_goals: 3, status: 'FULL_TIME', minute: null, confidence: 0.55, notes: 'the message says "it ended level at 3" but not clearly which game' }] })
        : '{}';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 100, output_tokens: 50 } }));
    });
  });
  await new Promise(r => server.listen(8899, '127.0.0.1', r));
  fx = (await call('/api/admin/scores/matchday')).data.cards[0];
  const all = (await call('/api/admin/league/fixtures')).data;
  restore = { id: fx.id, at: (all.fixtures || all.items).find(f => f.id === fx.id).kickoff };
  sql(`UPDATE league_fixtures SET kickoff_at = '${new Date(Date.now() - 100 * 60e3).toISOString()}' WHERE id = ${fx.id};`);
  sub = (await call('/api/admin/scores/submitters', 'POST', { action: 'add', name: 'Bala Test', club: `Kada ${TAG}`, email: `bala.${TAG}@example.com` })).data;
  const cur = (await call('/api/admin/scores/messages')).data;
  baseMsg = Math.max(0, ...cur.messages.map(m => m.id));
  baseReport = Math.max(0, ...(await call(`/api/admin/scores/reports?fixture=${fx.id}`)).data.reports.map(r => r.id));
});
after(async () => {
  server?.close();
  sql(`DELETE FROM score_reports WHERE id > ${baseReport} AND (fixture_id = ${fx?.id || 0} OR fixture_id IS NULL) AND received_at > '${new Date(Date.now() - 3600e3).toISOString().slice(0, 10)}';
       DELETE FROM score_messages WHERE id > ${baseMsg};
       DELETE FROM score_submitters WHERE club LIKE '%${TAG}%';
       ${restore ? `UPDATE league_fixtures SET kickoff_at = '${restore.at}' WHERE id = ${restore.id};` : ''}`);
});

test('a clear WhatsApp message from an approved submitter counts straight away (read by rules, no AI)', async () => {
  const before = claudeCalls;
  const r = await msgs({ action: 'paste', from: `submitter:${sub.id}`, text: `*FT*\n${fx.home.name} 2-1 ${fx.away.name}\nThanks ${TAG}` });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.method, 'rules');
  assert.equal(claudeCalls, before, 'Claude not asked');
  assert.equal(r.data.reports.length, 1);
  assert.equal(r.data.reports[0].fixtureId, fx.id, 'matched to the right game');
  assert.equal(r.data.reports[0].needsReview, false);
  const latest = (await call(`/api/admin/scores/reports?fixture=${fx.id}`)).data.latest;
  assert.ok(latest.some(x => x.source_identity === `submitter:${sub.id}` && x.home_goals === 2 && x.status === 'FULL_TIME'));
  const list = (await call('/api/admin/scores/messages')).data;
  const m = list.messages.find(x => x.id === r.data.messageId);
  assert.match(m.body, new RegExp(TAG), 'the original message is kept');
  assert.equal(m.status, 'read');
});

test('unknown sender: the report waits; approve makes it count; reject keeps it out', async () => {
  const r = await msgs({ action: 'paste', from: 'other', fromName: 'A fan', text: `FT ${fx.home.name} 0-1 ${fx.away.name}` });
  assert.equal(r.status, 200);
  assert.equal(r.data.reports[0].needsReview, true);
  assert.match(r.data.reports[0].reason, /not an approved submitter/);
  const bell = (await call('/api/admin/notifications')).data.items.find(i => /score report/.test(i.title));
  assert.ok(bell, 'shown on the admin bell');
  const latestBefore = (await call(`/api/admin/scores/reports?fixture=${fx.id}`)).data.latest;
  assert.ok(!latestBefore.some(x => x.id === r.data.reports[0].id), 'does not count while waiting');
  const ap = await msgs({ action: 'approve', reportId: r.data.reports[0].id, fixtureId: fx.id });
  assert.equal(ap.status, 200, JSON.stringify(ap.data));
  assert.equal((await msgs({ action: 'approve', reportId: r.data.reports[0].id, fixtureId: fx.id })).status, 400, 'only once');
  assert.ok((await call(`/api/admin/scores/reports?fixture=${fx.id}`)).data.latest.some(x => x.id === ap.data.id), 'counts after approval');

  const r2 = await msgs({ action: 'paste', from: 'other', fromName: 'Someone', text: `FT ${fx.home.name} 5-0 ${fx.away.name}` });
  assert.equal((await msgs({ action: 'reject', reportId: r2.data.reports[0].id, reason: '' })).status, 400, 'a reason is needed');
  assert.equal((await msgs({ action: 'reject', reportId: r2.data.reports[0].id, reason: 'old score' })).status, 200);
  const w = (await call('/api/admin/scores/messages')).data.waiting;
  assert.ok(!w.some(x => x.id === r2.data.reports[0].id), 'no longer waiting');
});

test('emails to scores@ are read: an approved submitter counts, an unknown sender waits', async () => {
  const post = body => fetch(`${BASE}/api/inbox/inbound?key=${INBOUND_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, data: await r.json() }));
  const ok = await post({ from: `Bala Test <bala.${TAG}@example.com>`, to: 'scores@lobistarsfc.com', subject: 'Half time', text: `HT: ${fx.home.name} 1-1 ${fx.away.name}` });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.scores, true);
  const list = (await call('/api/admin/scores/messages')).data;
  const m = list.messages.find(x => x.id === ok.data.messageId);
  assert.equal(m.channel, 'EMAIL');
  assert.equal(m.status, 'read');
  assert.equal(m.result[0].status, 'HALF_TIME');
  const bad = await post({ from: 'stranger@example.com', to: 'scores@lobistarsfc.com', subject: 'score', html: `<p>FT</p><p>${fx.home.name} 4-4 ${fx.away.name}</p>` });
  assert.equal(bad.data.status, 'needs_review', 'unknown sender waits');
  assert.equal((await fetch(`${BASE}/api/inbox/inbound?key=wrong`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
});

test('an unclear message goes to Claude; Claude\'s low-confidence answer waits for a person', async () => {
  const before = claudeCalls;
  const r = await msgs({ action: 'paste', from: `submitter:${sub.id}`, text: `Game don finish o, e end level at 3 ${TAG}` });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(claudeCalls, before + 1, 'Claude asked once');
  assert.equal(r.data.method, 'claude');
  assert.equal(r.data.reports[0].needsReview, true, 'not sure → a person checks');
  assert.match(r.data.reports[0].reason, /Not sure/);
});

test('only the Website & Data Officer and Super Admins', async () => {
  const email = `scm-${uid()}@example.com`;
  const made = await call('/api/admin/staff', 'POST', { name: 'Media test', email, password: 'Role-Test-2026!', role: 'head_of_media' });
  const login = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.8.${(Math.random() * 250) | 0}.4` }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
  const h = { Cookie: login.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' };
  assert.equal((await call('/api/admin/scores/messages', 'GET', null, h)).status, 403);
  await call(`/api/admin/staff/${made.data.id}`, 'PUT', { active: false, reason: 'test finished' });
});
