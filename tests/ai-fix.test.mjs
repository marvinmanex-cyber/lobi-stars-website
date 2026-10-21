// AI Fix on the server, against a local stand-in for Claude and GitHub (no
// money spent): Super Admins only, settings checks, Test connection, a fix
// prepared (bad JSON retried once), cached, applied as a GitHub commit and
// undone, drafts that need input, Message Batches, usage log and the budget stop.
// Needs the local Pages dev server started with ANTHROPIC_API_KEY,
// ANTHROPIC_BASE_URL=http://127.0.0.1:8899/v1, GITHUB_TOKEN, GITHUB_API_BASE=http://127.0.0.1:8899/gh
// and SITE_URL pointing at the server itself (see docs/ai-fix.md).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const CRON = { Authorization: `Bearer ${process.env.CRON_SECRET || 'cron-test-secret'}` };
const uid = () => Math.random().toString(36).slice(2, 8);
const sql = command => {
  const file = path.join(tmpdir(), `ai-test-${uid()}.sql`);
  writeFileSync(file, command);
  try { execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--file', `"${file}"`], { stdio: 'pipe', shell: true }); }
  finally { rmSync(file, { force: true }); }
};

// ── The stand-in for Anthropic and GitHub ──
const calls = [], files = new Map(), batches = new Map();
let seoCalls = 0;
const answer = system => {
  if (/connection test/.test(system)) return '{"ok": true}';
  if (/titles and descriptions/.test(system)) {
    seoCalls++;
    return seoCalls === 1 ? 'Sorry, here is my idea: a great title!' // not JSON: must be retried
      : '```json\n{"title": "Buy Lobi Stars Tickets Online | Lobi Stars FC", "description": "Official tickets for every Lobi Stars home match: pay online in a minute and get your QR ticket by email. <script>x</script>"}\n```';
  }
  if (/club news articles/.test(system)) return JSON.stringify({ title: 'Lobi Stars FC prepare for the new season', summary: 'Lobi Stars FC are getting ready for the new season with training in Makurdi this week.', body: 'Lobi Stars FC are back in training in Makurdi. '.repeat(10) + '\n\nSee the [fixtures](/fixtures/).' });
  if (/social media and newsletter/.test(system)) return JSON.stringify({ whatsapp: 'Lobi Stars are at home this weekend! Get your tickets: https://lobistarsfc.com/tickets/', facebook: 'Matchday is coming. Tickets are on sale now at https://lobistarsfc.com/tickets/', x: 'Tickets on sale now: https://lobistarsfc.com/tickets/' });
  return 'Plain answer about the figures.';
};
const reply = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ method: req.method, url: req.url, body, key: req.headers['x-api-key'] || req.headers.authorization });
    if (req.url === '/v1/messages' && req.method === 'POST') return reply(res, 200, { content: [{ type: 'text', text: answer(body.system) }], usage: { input_tokens: 400, output_tokens: 80 }, stop_reason: 'end_turn' });
    if (req.url === '/v1/messages/batches' && req.method === 'POST') { const id = `msgbatch_${uid()}`; batches.set(id, body.requests); return reply(res, 200, { id, processing_status: 'in_progress' }); }
    let m = req.url.match(/^\/v1\/messages\/batches\/([\w-]+)$/);
    if (m) return reply(res, 200, { id: m[1], processing_status: 'ended', results_url: `http://127.0.0.1:8899/v1/results/${m[1]}` });
    m = req.url.match(/^\/v1\/results\/([\w-]+)$/);
    if (m) { res.writeHead(200, { 'Content-Type': 'application/x-jsonl' }); return res.end((batches.get(m[1]) || []).map(r => JSON.stringify({ custom_id: r.custom_id, result: { type: 'succeeded', message: { content: [{ type: 'text', text: answer(r.params.system) }], usage: { input_tokens: 300, output_tokens: 60 } } } })).join('\n')); }
    m = req.url.match(/^\/gh\/repos\/[^/]+\/[^/]+\/contents\/([^?]+)/);
    if (m) {
      const p = decodeURIComponent(m[1]);
      if (req.method === 'GET') { const f = files.get(p); return f ? reply(res, 200, { sha: f.sha, content: Buffer.from(f.text).toString('base64') }) : reply(res, 404, { message: 'Not Found' }); }
      if (req.method === 'PUT') { const f = files.get(p); if (f && f.sha !== body.sha) return reply(res, 409, { message: 'sha mismatch' }); const sha = uid(); files.set(p, { sha, text: Buffer.from(body.content, 'base64').toString() }); return reply(res, 200, { commit: { sha: `c-${sha}` } }); }
      if (req.method === 'DELETE') { files.delete(p); return reply(res, 200, {}); }
    }
    reply(res, 404, { error: 'unknown' });
  });
});
const ai = (body, headers = ADMIN) => fetch(`${BASE}/api/admin/ai`, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers });
const items = async () => (await (await ai()).json()).items;
const resetAi = () => sql(`DELETE FROM ai_usage_log; DELETE FROM ai_recommendation_meta; DELETE FROM ai_batches; DELETE FROM ai_settings;`);

before(async () => {
  await new Promise(r => server.listen(8899, '127.0.0.1', r));
  await fetch(`${BASE}/api/admin/ai`, { headers: ADMIN }); // creates the tables
  resetAi();
  // A page Google shows a lot but people rarely click: the "ctr" recommendation (Claude can prepare it).
  sql(`INSERT OR REPLACE INTO gsc_daily (date, dim, value, clicks, impressions, ctr, position)
       VALUES ((SELECT COALESCE(MAX(date), date('now')) FROM gsc_daily WHERE dim = 'total'), 'page', 'https://lobistarsfc.com/membership/', 2, 900, 0.002, 6.5);`);
});
after(async () => {
  sql(`DELETE FROM gsc_daily WHERE dim = 'page' AND value = 'https://lobistarsfc.com/membership/' AND impressions = 900;`);
  resetAi();
  await new Promise(r => server.close(r));
});

test('Super Admins only; changes from another website refused', async () => {
  const email = `ai-${uid()}@example.com`;
  const r = await fetch(`${BASE}/api/admin/staff`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ name: 'AI Test', email, password: 'Role-Test-2026!', role: 'head_of_media' }) });
  const staffId = (await r.json()).id;
  const login = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.7.${uid().length}.9` }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  for (const p of ['/api/admin/ai', '/api/admin/ai/settings']) assert.equal((await fetch(BASE + p, { headers: { Cookie: cookie } })).status, 403, p);
  assert.equal((await fetch(`${BASE}/admin/ai/`, { headers: { Cookie: cookie }, redirect: 'manual' })).status, 403);
  assert.equal((await fetch(`${BASE}/api/admin/ai`)).status, 401);
  assert.equal((await ai({ action: 'prepare_all' }, { ...ADMIN, Origin: 'https://evil.example' })).status, 403);
  await fetch(`${BASE}/api/admin/staff/${staffId}`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ active: false, reason: 'test finished' }) });
});

test('settings are checked; Test connection uses the smallest call and is logged', async () => {
  const put = b => fetch(`${BASE}/api/admin/ai/settings`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ monthly_budget: 10, warn_at_percent: 80, max_items_per_batch: 50, weekly_scan_day: '1', weekly_scan_time: '07:00', auto_apply_enabled: true, auto_apply_types: ['rerun_sync', 'seo_title_description'], ask_claude_enabled: true, ...b }) });
  assert.equal((await put({ monthly_budget: -1 })).status, 400);
  assert.equal((await put({ weekly_scan_time: '7am' })).status, 400);
  assert.equal((await put({ prices: { 'claude-haiku-5-5': { in: 'abc' } } })).status, 400);
  assert.equal((await put({ prices: { 'claude-haiku-5-5': { in: 1, out: 5 } } })).status, 200);
  const s = await (await fetch(`${BASE}/api/admin/ai/settings`, { headers: ADMIN })).json();
  assert.equal(s.settings.auto_apply_types, 'rerun_sync', 'changing pages is never automatic');
  assert.equal(s.prices['claude-haiku-5-5'].assumed, false);
  const t = await (await fetch(`${BASE}/api/admin/ai/settings`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ action: 'test' }) })).json();
  assert.equal(t.ok, true);
  assert.equal(t.model, 'claude-haiku-5-5', 'the cheap model by default');
  const last = calls.filter(c => c.url === '/v1/messages').at(-1);
  assert.equal(last.key, 'sk-test-local');
  assert.ok(last.body.max_tokens <= 30);
  const s2 = await (await fetch(`${BASE}/api/admin/ai/settings`, { headers: ADMIN })).json();
  assert.ok(s2.byFeature.some(f => f.feature === 'test' && f.calls === 1));
});

test('a Google title fix: prepared (bad JSON retried once), cleaned, cached, applied as a commit, undone', async () => {
  const id = 'ctr:/membership/';
  let it = (await items()).find(i => i.id === id);
  assert.ok(it, 'the recommendation is listed');
  assert.equal(it.category, 'auto_fix');
  const before = calls.length;
  const p = await (await ai({ action: 'prepare', id })).json();
  assert.equal(p.ok, true, JSON.stringify(p));
  const sent = calls.slice(before).filter(c => c.url === '/v1/messages');
  assert.equal(sent.length, 2, 'one retry after the answer that was not JSON');
  assert.ok(sent[0].body.max_tokens <= 300);
  assert.doesNotMatch(JSON.stringify(sent[0].body), /@|password|phone/i, 'no personal data sent');
  it = (await items()).find(i => i.id === id);
  assert.equal(it.status, 'awaiting_approval');
  assert.equal(it.proposal.title, 'Buy Lobi Stars Tickets Online | Lobi Stars FC');
  assert.doesNotMatch(it.proposal.description, /script/, 'HTML removed');
  // The same facts are never sent twice.
  const n = calls.length;
  assert.equal((await (await ai({ action: 'prepare', id })).json()).cached, true);
  assert.equal(calls.length, n, 'no new Claude call');
  // Apply = one commit to src/data/seo.json only.
  const a = await (await ai({ action: 'apply', id })).json();
  assert.equal(a.ok, true, JSON.stringify(a));
  const seo = JSON.parse(files.get('src/data/seo.json').text);
  assert.equal(seo['/membership/'].title, 'Buy Lobi Stars Tickets Online | Lobi Stars FC');
  assert.equal((await items()).find(i => i.id === id).status, 'applied');
  assert.equal((await (await ai({ action: 'undo', id })).json()).ok, true);
  assert.equal(JSON.parse(files.get('src/data/seo.json').text)['/membership/'], undefined, 'undo removed it again');
  assert.equal((await items()).find(i => i.id === id).status, 'undone');
});

test('drafts need the facts first; a news draft is committed as Draft; manual items cannot be fixed', async () => {
  const rank = (await items()).find(i => i.type === 'rank');
  assert.ok(rank);
  assert.equal((await ai({ action: 'prepare', id: rank.id, input: { text: 'short' } })).status, 400, 'at least 40 characters of facts');
  const p = await (await ai({ action: 'prepare', id: rank.id, input: { text: 'Lobi Stars FC start pre-season training in Makurdi on Monday with 28 players.' } })).json();
  assert.equal(p.ok, true, JSON.stringify(p));
  const sent = calls.filter(c => c.url === '/v1/messages').at(-1);
  assert.match(JSON.stringify(sent.body), /pre-season training/, "the staff's facts are used");
  const a = await (await ai({ action: 'apply', id: rank.id })).json();
  assert.equal(a.ok, true, JSON.stringify(a));
  const draft = [...files.keys()].find(k => k.startsWith('src/content/news/'));
  assert.ok(draft);
  assert.match(files.get(draft).text, /status: "draft"/);
  assert.equal((await (await ai({ action: 'undo', id: rank.id })).json()).ok, true);
  assert.ok(!files.has(draft), 'the draft is removed again');
  const manual = (await items()).find(i => i.category === 'manual_only');
  if (manual) assert.equal((await ai({ action: 'prepare', id: manual.id })).status, 400);
  assert.equal((await ai({ action: 'prepare', id: 'ctr:/not-a-recommendation/' })).status, 400);
});

test('Prepare all goes in one Message Batch; the timer collects the results', async () => {
  sql(`DELETE FROM ai_recommendation_meta WHERE rec_id = 'ctr:/membership/';`);
  const r = await (await ai({ action: 'prepare_all' })).json();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.sent >= 1);
  assert.equal((await items()).find(i => i.id === 'ctr:/membership/').status, 'preparing');
  sql(`DELETE FROM ai_settings WHERE key = 'last_poll_at';`);
  const run = await (await fetch(`${BASE}/api/internal/ai-run`, { method: 'POST', headers: CRON })).json();
  assert.equal(run.batches?.finished, 1, JSON.stringify(run));
  assert.equal((await items()).find(i => i.id === 'ctr:/membership/').status, 'awaiting_approval');
  const s = await (await fetch(`${BASE}/api/admin/ai/settings`, { headers: ADMIN })).json();
  assert.ok(s.byFeature.some(f => f.feature === 'batch_fix'), 'batch usage logged');
  assert.equal((await fetch(`${BASE}/api/internal/ai-run`, { method: 'POST' })).status, 403);
});

test('Ask Claude keeps 6 messages; the budget stops everything except Test connection', async () => {
  const msgs = Array.from({ length: 9 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `message ${i}` }));
  const a = await (await fetch(`${BASE}/api/admin/ai/ask`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ messages: msgs }) })).json();
  assert.equal(a.reply, 'Plain answer about the figures.');
  assert.ok(calls.filter(c => c.url === '/v1/messages').at(-1).body.messages.length <= 6);
  sql(`INSERT INTO ai_usage_log (feature, model, input_tokens, output_tokens, estimated_cost, success, month, created_at)
       VALUES ('fix', 'claude-haiku-5-5', 0, 0, 50, 1, strftime('%Y-%m', 'now', '+1 hour'), datetime('now'));`);
  const blocked = await ai({ action: 'prepare', id: (await items()).find(i => i.type === 'rank').id, input: { text: 'Lobi Stars FC sign a new striker from Kano this week, says the club.' } });
  assert.equal(blocked.status, 400);
  assert.match((await blocked.json()).error, /Monthly AI budget reached/);
  const me = await (await fetch(`${BASE}/api/admin/me`, { headers: ADMIN })).json();
  assert.equal(me.admin.aiBudgetReached, true, 'the admin shows the budget bar');
  const t = await (await fetch(`${BASE}/api/admin/ai/settings`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ action: 'test' }) })).json();
  assert.equal(t.ok, true, 'Test connection still works');
});
