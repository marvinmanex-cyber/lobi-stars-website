// AI Fix on the server, against a local stand-in for Claude and GitHub (no
// money spent): who may do what, settings checks, Test connection, a fix
// prepared (bad JSON retried once), cached, edited, tried again with a note,
// applied as a GitHub commit, undone (with the "edited since" warning), drafts
// that need input (and Claude asking for missing facts), Fix all (estimate,
// batch, ready email, bulk apply), history, results, dry run, the weekly
// check-up once a week, code proposals on a branch, checklist drafts, Ask
// Claude (6 messages, personal data removed) and the budget stop.
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
const calls = [], files = new Map(), batches = new Map(), branches = new Set(), pulls = [];
let seoCalls = 0;
const answer = (system, body) => {
  const asked = JSON.stringify(body?.messages || []);
  if (/connection test/.test(system)) return '{"ok": true}';
  if (/needs-test/.test(asked)) return '{"needs": "Who scored the goals?"}';
  if (/titles and descriptions/.test(system)) {
    seoCalls++;
    return seoCalls === 1 ? 'Sorry, here is my idea: a great title!' // not JSON: must be retried
      : '```json\n{"title": "Buy Lobi Stars Tickets Online | Lobi Stars FC", "description": "Official tickets for every Lobi Stars home match: pay online in a minute and get your QR ticket by email. <script>x</script>"}\n```';
  }
  if (/club news articles/.test(system)) return JSON.stringify({ title: 'Lobi Stars FC prepare for the new season', summary: 'Lobi Stars FC are getting ready for the new season with training in Makurdi this week.', body: 'Lobi Stars FC are back in training in Makurdi. '.repeat(10) + '\n\nSee the [fixtures](/fixtures/).' });
  if (/media team of Lobi Stars/.test(system)) return /three short/.test(asked)
    ? JSON.stringify({ whatsapp: 'Big match this Sunday at home! Tickets: https://lobistarsfc.com/tickets/', facebook: 'Matchday is coming. Get your tickets at https://lobistarsfc.com/tickets/', x: 'Tickets: https://lobistarsfc.com/tickets/' })
    : JSON.stringify({ title: 'Lobi Stars FC beat Bichi First at home', summary: 'Lobi Stars FC won at home in front of a big crowd in Makurdi on Sunday afternoon.', body: 'Lobi Stars FC won at home on Sunday. '.repeat(12) });
  if (/social media and newsletter/.test(system)) return JSON.stringify({ whatsapp: 'Lobi Stars are at home this weekend! Get your tickets: https://lobistarsfc.com/tickets/', facebook: 'Matchday is coming. Tickets are on sale now at https://lobistarsfc.com/tickets/', x: 'Tickets on sale now: https://lobistarsfc.com/tickets/' });
  if (/careful web developer/.test(system)) return JSON.stringify({ summary: 'Added a Join now button at the top so visitors see it first.', edits: [{ find: '<h1>Membership</h1>', replace: '<h1>Membership</h1>\n<a class="btn" href="#join">Join now</a>' }] });
  return 'Plain answer about the figures.';
};
const reply = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
const GH = /^\/gh\/repos\/[^/]+\/[^/]+/;
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ method: req.method, url: req.url, body, key: req.headers['x-api-key'] || req.headers.authorization });
    if (req.url === '/v1/messages' && req.method === 'POST') return reply(res, 200, { content: [{ type: 'text', text: answer(body.system, body) }], usage: { input_tokens: 400, output_tokens: 80 }, stop_reason: 'end_turn' });
    if (req.url === '/v1/messages/batches' && req.method === 'POST') { const id = `msgbatch_${uid()}`; batches.set(id, body.requests); return reply(res, 200, { id, processing_status: 'in_progress' }); }
    let m = req.url.match(/^\/v1\/messages\/batches\/([\w-]+)$/);
    if (m) return reply(res, 200, { id: m[1], processing_status: 'ended', results_url: `http://127.0.0.1:8899/v1/results/${m[1]}` });
    m = req.url.match(/^\/v1\/results\/([\w-]+)$/);
    if (m) { res.writeHead(200, { 'Content-Type': 'application/x-jsonl' }); return res.end((batches.get(m[1]) || []).map(r => JSON.stringify({ custom_id: r.custom_id, result: { type: 'succeeded', message: { content: [{ type: 'text', text: answer(r.params.system, r.params) }], usage: { input_tokens: 300, output_tokens: 60 } } } })).join('\n')); }
    if (GH.test(req.url)) {
      const rest = req.url.replace(GH, '');
      if (rest === '/git/ref/heads/main') return reply(res, 200, { object: { sha: 'base-sha' } });
      if (rest === '/git/refs' && req.method === 'POST') { branches.add(body.ref.replace('refs/heads/', '')); return reply(res, 201, {}); }
      if (rest === '/pulls' && req.method === 'POST') { pulls.push(body); return reply(res, 403, { message: 'Resource not accessible by personal access token' }); }
      m = rest.match(/^\/contents\/([^?]+)(?:\?ref=(.+))?$/);
      if (m) {
        const ref = decodeURIComponent(m[2] || body?.branch || 'main');
        const p = (ref === 'main' ? '' : `${ref}:`) + decodeURIComponent(m[1]);
        if (req.method === 'GET') { const f = files.get(p); return f ? reply(res, 200, { sha: f.sha, content: Buffer.from(f.text).toString('base64') }) : reply(res, 404, { message: 'Not Found' }); }
        if (req.method === 'PUT') { const f = files.get(p); if (f && f.sha !== body.sha) return reply(res, 409, { message: 'sha mismatch' }); const sha = uid(); files.set(p, { sha, text: Buffer.from(body.content, 'base64').toString() }); return reply(res, 200, { commit: { sha: `c-${sha}` } }); }
        if (req.method === 'DELETE') { files.delete(p); return reply(res, 200, {}); }
      }
    }
    reply(res, 404, { error: 'unknown' });
  });
});
const ai = (body, headers = ADMIN) => fetch(`${BASE}/api/admin/ai`, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers });
const items = async () => (await (await ai()).json()).items;
const lastClaude = () => calls.filter(c => c.url === '/v1/messages').at(-1);
const claudeCount = () => calls.filter(c => c.url.startsWith('/v1/')).length;
const history = async q => (await (await fetch(`${BASE}/api/admin/ai/history${q ? `?${q}` : ''}`, { headers: ADMIN })).json()).rows;
const resetAi = () => sql(`DELETE FROM ai_usage_log; DELETE FROM ai_recommendation_meta; DELETE FROM ai_batches; DELETE FROM ai_settings; DELETE FROM ai_fix_log; DELETE FROM ai_fix_results;`);
async function staffCookie(role) {
  const email = `ai-${role}-${uid()}@example.com`;
  const r = await fetch(`${BASE}/api/admin/staff`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ name: `AI ${role}`, email, password: 'Role-Test-2026!', role }) });
  const id = (await r.json()).id;
  const login = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.7.${(Math.random() * 250) | 0}.9` }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
  return { id, h: { Cookie: login.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' } };
}
const made = [];

before(async () => {
  await new Promise(r => server.listen(8899, '127.0.0.1', r));
  await fetch(`${BASE}/api/admin/ai`, { headers: ADMIN }); // creates the tables
  await fetch(`${BASE}/api/admin/ai/history`, { headers: ADMIN });
  resetAi();
  files.set('src/pages/membership/index.astro', { sha: 'm1', text: '---\nimport Layout from "../../layouts/Layout.astro";\n---\n<Layout title="Membership">\n<h1>Membership</h1>\n<p>Join the club.</p>\n</Layout>\n' });
  // A page Google shows a lot but people rarely click: the "ctr" recommendation (Claude can prepare it).
  sql(`INSERT OR REPLACE INTO gsc_daily (date, dim, value, clicks, impressions, ctr, position)
       VALUES ((SELECT COALESCE(MAX(date), date('now')) FROM gsc_daily WHERE dim = 'total'), 'page', 'https://lobistarsfc.com/membership/', 2, 900, 0.002, 6.5);`);
});
after(async () => {
  sql(`DELETE FROM gsc_daily WHERE dim = 'page' AND value = 'https://lobistarsfc.com/membership/' AND impressions = 900;`);
  resetAi();
  for (const id of made) await fetch(`${BASE}/api/admin/staff/${id}`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ active: false, reason: 'test finished' }) });
  await new Promise(r => server.close(r));
});

test('two levels: report roles can look and prepare; only Super Admins apply, edit, undo, Fix all, settings, code', async () => {
  const hom = await staffCookie('head_of_media'), fan = await staffCookie('fan_support');
  made.push(hom.id, fan.id);
  assert.equal((await fetch(`${BASE}/api/admin/ai`, { headers: hom.h })).status, 200, 'Head of Media sees AI Fix');
  assert.equal((await fetch(`${BASE}/api/admin/ai/history`, { headers: hom.h })).status, 200);
  assert.equal((await fetch(`${BASE}/api/admin/ai/results`, { headers: hom.h })).status, 200);
  for (const action of ['apply', 'edit', 'undo', 'dismiss', 'apply_many', 'estimate_all', 'prepare_all']) assert.equal((await ai({ action, id: 'ctr:/membership/' }, hom.h)).status, 403, action);
  for (const p of ['/api/admin/ai/settings', '/api/admin/ai/code']) assert.equal((await fetch(BASE + p, { headers: hom.h })).status, 403, p);
  assert.equal((await fetch(`${BASE}/admin/ai/settings/`, { headers: hom.h, redirect: 'manual' })).status, 403);
  assert.equal((await fetch(`${BASE}/api/admin/ai`, { headers: fan.h })).status, 403, 'roles without reports: no AI Fix');
  assert.equal((await fetch(`${BASE}/api/admin/ai`)).status, 401);
  assert.equal((await ai({ action: 'prepare_all' }, { ...ADMIN, Origin: 'https://evil.example' })).status, 403);
});

test('settings are checked; advanced model only for long writing; Test connection is the smallest call', async () => {
  const put = b => fetch(`${BASE}/api/admin/ai/settings`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ monthly_budget: 10, warn_at_percent: 80, max_items_per_batch: 50, weekly_scan_day: '1', weekly_scan_time: '07:00', auto_apply_enabled: true, auto_apply_types: ['rerun_sync', 'seo_title_description', 'draft_social_post'], ask_claude_enabled: true, ...b }) });
  assert.equal((await put({ monthly_budget: -1 })).status, 400);
  assert.equal((await put({ weekly_scan_time: '7am' })).status, 400);
  assert.equal((await put({ prices: { 'claude-haiku-5-5': { in: 'abc' } } })).status, 400);
  assert.equal((await put({ prices: { 'claude-haiku-5-5': { in: 1, out: 5 } }, models: { fix: 'advanced', code_proposal: 'advanced' }, taskModels: { draft_news: 'advanced' } })).status, 200);
  const s = await (await fetch(`${BASE}/api/admin/ai/settings`, { headers: ADMIN })).json();
  assert.equal(s.settings.auto_apply_types, 'rerun_sync', 'page changes and fact texts are never automatic');
  assert.equal(s.settings.model_fix, 'default', 'short fixes always use the cheap model');
  assert.equal(s.settings.model_code_proposal, 'advanced');
  assert.equal(s.settings.model_task_draft_news, 'advanced');
  assert.equal((await put({})).status, 200, 'back to cheap everywhere');
  assert.equal(s.prices['claude-haiku-5-5'].assumed, false);
  const t = await (await fetch(`${BASE}/api/admin/ai/settings`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ action: 'test' }) })).json();
  assert.equal(t.ok, true);
  assert.equal(t.model, 'claude-haiku-5-5', 'the cheap model by default');
  assert.equal(lastClaude().key, 'sk-test-local');
  assert.ok(lastClaude().body.max_tokens <= 30);
  const s2 = await (await fetch(`${BASE}/api/admin/ai/settings`, { headers: ADMIN })).json();
  assert.ok(s2.byFeature.some(f => f.feature === 'test' && f.calls === 1));
});

test('a Google title fix: retried once on bad JSON, cleaned, cached, edited, tried again, applied, undo warns if edited since', async () => {
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
  assert.ok(it.proposal.before, 'the old wording is kept for the before/after preview');
  const n = claudeCount();
  assert.equal((await (await ai({ action: 'prepare', id })).json()).cached, true);
  assert.equal(claudeCount(), n, 'the same facts are never sent twice');
  // Try again with a note: always asks again, with the note.
  assert.equal((await (await ai({ action: 'prepare', id, note: 'mention online payment' })).json()).ok, true);
  assert.match(JSON.stringify(lastClaude().body), /mention online payment/);
  assert.equal((await items()).find(i => i.id === id).proposal.note, 'mention online payment');
  // Edit before applying (checked again).
  assert.equal((await ai({ action: 'edit', id, proposal: { title: 'x' } })).status, 400);
  assert.equal((await (await ai({ action: 'edit', id, proposal: { title: 'Lobi Stars Membership: Join Today | Lobi Stars FC' } })).json()).ok, true);
  // Apply = one commit to src/data/seo.json only; the figure is recorded for Fix results.
  const a = await (await ai({ action: 'apply', id })).json();
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(JSON.parse(files.get('src/data/seo.json').text)['/membership/'].title, 'Lobi Stars Membership: Join Today | Lobi Stars FC');
  assert.equal((await items()).find(i => i.id === id).status, 'applied');
  const results = (await (await fetch(`${BASE}/api/admin/ai/results`, { headers: ADMIN })).json()).results;
  assert.equal(results[0].recId, id);
  assert.equal(results[0].before.metric, 'ctr');
  // Someone changes the title again on GitHub: Undo asks first.
  const f = files.get('src/data/seo.json'), data = JSON.parse(f.text);
  data['/membership/'].title = 'Changed by hand after AI Fix';
  files.set('src/data/seo.json', { sha: 'hand', text: JSON.stringify(data) });
  const warn = await ai({ action: 'undo', id });
  assert.equal(warn.status, 409);
  assert.match((await warn.json()).error, /changed again since/);
  assert.equal((await (await ai({ action: 'undo', id, force: true })).json()).ok, true);
  assert.equal(JSON.parse(files.get('src/data/seo.json').text)['/membership/'], undefined, 'undo restored the exact previous state');
  assert.equal((await items()).find(i => i.id === id).status, 'undone');
  const steps = (await history(`q=${encodeURIComponent('membership')}`)).map(r => r.action);
  for (const step of ['prepared', 'retried', 'edited', 'applied', 'undone']) assert.ok(steps.includes(step), `history has ${step}`);
});

test('drafts need the facts; personal data removed; Claude asks when facts are missing; news saved as Draft', async () => {
  const rank = (await items()).find(i => i.type === 'rank');
  assert.ok(rank);
  assert.equal((await ai({ action: 'prepare', id: rank.id, input: { text: 'short' } })).status, 400, 'at least 40 characters of facts');
  const q = await (await ai({ action: 'prepare', id: rank.id, input: { text: 'needs-test: Lobi Stars won on Sunday at home, a great game for everyone.' } })).json();
  assert.equal(q.needs, 'Who scored the goals?');
  const it = (await items()).find(i => i.id === rank.id);
  assert.equal(it.status, 'awaiting_input');
  assert.equal(it.input.question, 'Who scored the goals?');
  const p = await (await ai({ action: 'prepare', id: rank.id, input: { text: 'Lobi Stars FC start pre-season training in Makurdi on Monday with 28 players. Call 0803 123 4567 or mail coach@example.com.' } })).json();
  assert.equal(p.ok, true, JSON.stringify(p));
  const body = JSON.stringify(lastClaude().body);
  assert.match(body, /pre-season training/, "the staff's facts are used");
  assert.doesNotMatch(body, /0803 123 4567|coach@example\.com/, 'emails and phone numbers removed');
  assert.match(body, /needs/, 'Claude is told to ask instead of inventing');
  const a = await (await ai({ action: 'apply', id: rank.id })).json();
  assert.equal(a.ok, true, JSON.stringify(a));
  const draft = [...files.keys()].find(k => k.startsWith('src/content/news/'));
  assert.match(files.get(draft).text, /status: "draft"/);
  assert.equal((await (await ai({ action: 'undo', id: rank.id })).json()).ok, true);
  assert.ok(!files.has(draft), 'the draft is removed again');
  const manual = (await items()).find(i => i.category === 'manual_only');
  if (manual) assert.equal((await ai({ action: 'prepare', id: manual.id })).status, 400);
  assert.equal((await ai({ action: 'prepare', id: 'ctr:/not-a-recommendation/' })).status, 400);
});

test('Fix all: grouped estimate with cost, one batch, "ready" email, bulk apply; dry run spends nothing', async () => {
  sql(`DELETE FROM ai_recommendation_meta WHERE rec_id = 'ctr:/membership/';`);
  const n = claudeCount();
  const dry = await (await fetch(`${BASE}/api/internal/ai-run?action=dry_run`, { method: 'POST', headers: CRON })).json();
  assert.equal(dry.dryRun, true);
  assert.ok(dry.wouldSendToClaude.some(x => x.id === 'ctr:/membership/'));
  assert.ok(dry.estimatedCost > 0);
  assert.equal(claudeCount(), n, 'dry run: no AI');
  const est = await (await ai({ action: 'estimate_all' })).json();
  assert.ok(est.count >= 1 && est.cost > 0);
  assert.ok(est.groups.some(g => g.type === 'seo_title_description' && g.count >= 1 && g.cost > 0));
  assert.equal(claudeCount(), n, 'estimate: no AI');
  const r = await (await ai({ action: 'prepare_all', types: ['seo_title_description'] })).json();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.sent >= 1 && r.cost > 0);
  assert.equal((await items()).find(i => i.id === 'ctr:/membership/').status, 'preparing');
  sql(`DELETE FROM ai_settings WHERE key = 'last_poll_at';`);
  const run = await (await fetch(`${BASE}/api/internal/ai-run`, { method: 'POST', headers: CRON })).json();
  assert.equal(run.batches?.finished, 1, JSON.stringify(run));
  assert.equal((await items()).find(i => i.id === 'ctr:/membership/').status, 'awaiting_approval');
  assert.ok((await history('action=email')).some(m => /batch_ready/.test(m.detail)), 'the Super Admins get a "ready" email (mail log)');
  const s = await (await fetch(`${BASE}/api/admin/ai/settings`, { headers: ADMIN })).json();
  assert.ok(s.byFeature.some(f => f.feature === 'batch_fix'), 'batch usage logged');
  const bulk = await (await ai({ action: 'apply_many', ids: ['ctr:/membership/'] })).json();
  assert.equal(bulk.done, 1, JSON.stringify(bulk));
  assert.equal((await items()).find(i => i.id === 'ctr:/membership/').status, 'applied');
  assert.equal((await fetch(`${BASE}/api/internal/ai-run`, { method: 'POST' })).status, 403);
});

test('weekly check-up: once a week only, with a summary email', async () => {
  const lagos = new Date(Date.now() + 3600e3);
  const settings = (await (await fetch(`${BASE}/api/admin/ai/settings`, { headers: ADMIN })).json()).settings;
  await fetch(`${BASE}/api/admin/ai/settings`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ ...settings, monthly_budget: 10, warn_at_percent: 80, max_items_per_batch: 50, weekly_scan_day: String(lagos.getUTCDay()), weekly_scan_time: '00:00', auto_apply_enabled: true, auto_apply_types: ['rerun_sync'], ask_claude_enabled: true }) });
  sql(`DELETE FROM ai_settings WHERE key IN ('last_scan_week', 'last_poll_at');`);
  const first = await (await fetch(`${BASE}/api/internal/ai-run`, { method: 'POST', headers: CRON })).json();
  assert.ok(first.scan, JSON.stringify(first));
  const second = await (await fetch(`${BASE}/api/internal/ai-run`, { method: 'POST', headers: CRON })).json();
  assert.equal(second.scan, undefined, 'not twice in a week');
  assert.equal((await history('action=email')).filter(m => /weekly_summary/.test(m.detail)).length, 1);
});

test('code proposals: Super Admins only, saved on an ai-proposal/ branch, never on the live branch', async () => {
  const code = b => fetch(`${BASE}/api/admin/ai/code`, { method: 'POST', headers: ADMIN, body: JSON.stringify(b) });
  assert.equal((await code({ action: 'estimate', recId: 'ctr:/membership/' })).status, 400, 'only for layout recommendations');
  const est = await (await code({ action: 'estimate', recId: 'eng:/membership/' })).json();
  assert.equal(est.path, 'src/pages/membership/index.astro');
  assert.ok(est.cost > 0);
  const liveBefore = files.get('src/pages/membership/index.astro').text;
  const r = await (await code({ action: 'propose', recId: 'eng:/membership/' })).json();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.branch, /^ai-proposal\//);
  assert.ok(branches.has(r.branch));
  assert.match(files.get(`${r.branch}:src/pages/membership/index.astro`).text, /Join now/);
  assert.equal(files.get('src/pages/membership/index.astro').text, liveBefore, 'the live file is untouched');
  assert.equal(pulls[0].draft, true, 'a draft pull request was asked for (never merged by the website)');
  assert.match(r.note, /Pull requests/, 'explains the missing permission');
  const dl = await fetch(`${BASE}/api/admin/ai/code?download=${r.id}`, { headers: ADMIN });
  assert.match(await dl.text(), /NOT LIVE/);
  assert.ok((await history('action=code_proposed')).length >= 1);
});

test('checklist "Draft with Claude": facts filled in, asks when needed, saved as a Draft, task to submitted for review', async () => {
  const cl = (await (await fetch(`${BASE}/api/admin/match-checklist`, { headers: ADMIN })).json()).checklists[0];
  const report = cl.tasks.find(t => t.title === 'Match report published'), thanks = cl.tasks.find(t => t.title === 'Thank-you post for fans and sponsors');
  const interviews = cl.tasks.find(t => t.title === 'Post-match press conference / interviews');
  const url = t => `${BASE}/api/admin/match-checklist/tasks/${t.id}/draft`;
  const info = await (await fetch(url(report), { headers: ADMIN })).json();
  assert.equal(info.available, true);
  assert.match(info.facts.match, / vs /, 'the match is filled in automatically');
  assert.equal((await (await fetch(`${BASE}/api/admin/match-checklist/tasks/${cl.tasks.find(t => !t.link && !/report|interview|Injury|Social|Thank/.test(t.title)).id}/draft`, { headers: ADMIN })).json()).available, false);
  const post = (t, b, h = ADMIN) => fetch(url(t), { method: 'POST', headers: h, body: JSON.stringify(b) });
  assert.equal((await post(interviews, { action: 'prepare', facts: '' })).status, 400, 'interviews need the real quotes');
  assert.equal((await (await post(report, { action: 'prepare', facts: 'needs-test' })).json()).needs, 'Who scored the goals?');
  const d = await (await post(report, { action: 'prepare', facts: 'A great win. Ring 08031234567 for photos.' })).json();
  assert.ok(d.proposal?.title, JSON.stringify(d));
  assert.doesNotMatch(JSON.stringify(lastClaude().body), /08031234567/);
  await fetch(`${BASE}/api/admin/match-checklist/tasks/${report.id}`, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ status: 'in_progress', reason: 'test' }) });
  const saved = await (await post(report, { action: 'save', proposal: { title: 'Lobi Stars FC win at home on Sunday' } })).json();
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const news = files.get(saved.saved.path);
  assert.match(news.text, /status: "draft"/);
  assert.match(news.text, /contentType: "Match Report"/);
  assert.match(news.text, /Lobi Stars FC win at home on Sunday/, 'the edited headline is used');
  const after = (await (await fetch(`${BASE}/api/admin/match-checklist?task=${report.id}`, { headers: ADMIN })).json()).checklists[0].tasks.find(t => t.id === report.id);
  assert.equal(after.status, 'submitted_for_review');
  assert.equal((await (await post(thanks, { action: 'prepare', facts: '' })).json()).proposal.x.length > 0, true);
  assert.equal((await (await post(thanks, { action: 'save', proposal: {} })).json()).saved.note, 'Posts copied and used.');
  const fan = await staffCookie('fan_support'); made.push(fan.id);
  assert.equal((await post(report, { action: 'prepare', facts: 'x' }, fan.h)).status, 403, 'drafting is not part of every role');
});

test('Ask Claude keeps 6 messages and removes personal data; the budget stops everything except Test connection', async () => {
  const msgs = Array.from({ length: 9 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `message ${i}` }));
  msgs[8].content = 'Why are clicks down? My number is 0803 123 4567.';
  const a = await (await fetch(`${BASE}/api/admin/ai/ask`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ messages: msgs }) })).json();
  assert.equal(a.reply, 'Plain answer about the figures.');
  assert.ok(lastClaude().body.messages.length <= 6);
  assert.doesNotMatch(JSON.stringify(lastClaude().body), /0803 123 4567/);
  assert.equal(lastClaude().body.tools, undefined, 'read-only: Claude gets no tools');
  sql(`INSERT INTO ai_usage_log (feature, model, input_tokens, output_tokens, estimated_cost, success, month, created_at)
       VALUES ('fix', 'claude-haiku-5-5', 0, 0, 50, 1, strftime('%Y-%m', 'now', '+1 hour'), datetime('now'));`);
  const blocked = await ai({ action: 'prepare', id: (await items()).find(i => i.type === 'rank').id, input: { text: 'Lobi Stars FC sign a new striker from Kano this week, says the club.' } });
  assert.equal(blocked.status, 400);
  assert.match((await blocked.json()).error, /Monthly AI budget reached/);
  const me = await (await fetch(`${BASE}/api/admin/me`, { headers: ADMIN })).json();
  assert.equal(me.admin.aiBudgetReached, true, 'the admin shows the budget bar');
  assert.ok((await history('action=email')).some(m => /budget_warning/.test(m.detail)), 'the warning email is in the mail log');
  const t = await (await fetch(`${BASE}/api/admin/ai/settings`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ action: 'test' }) })).json();
  assert.equal(t.ok, true, 'Test connection still works');
});
