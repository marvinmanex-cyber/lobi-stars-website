// Website Health › the three buttons: 1. "Fix it for me" (the website's safe
// fix, no AI), 2. "Teach AI to fix this next time" (switch a safe fix to run by
// itself, or Claude's one-time setup steps), 3. "Show me how to fix it myself"
// (steps written by Claude, kept and reused). Super Admins only.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123,
// ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL=http://127.0.0.1:8899/v1 (this test answers as Claude).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 8);
const sql = command => {
  const file = path.join(tmpdir(), `health-ai-test-${uid()}.sql`);
  writeFileSync(file, command);
  try { execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--file', `"${file}"`], { stdio: 'pipe', shell: true }); }
  finally { rmSync(file, { force: true }); }
};
const call = (body, h = ADMIN) => fetch(`${BASE}/api/admin/health`, { method: body ? 'POST' : 'GET', headers: h, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));

let server, asked = 0;
before(async () => {
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      if (/Website Health check/.test(JSON.stringify(body.messages || []))) asked++;
      const text = JSON.stringify({ summary: 'This check needs a small change by the developer.', who: 'Developer', minutes: 10, steps: '1. Open Settings › Website Health.\n2. Press "Copy details for developer".\n3. Send the details to the developer on WhatsApp.' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 200, output_tokens: 80 } }));
    });
  });
  await new Promise(r => server.listen(8899, '127.0.0.1', r));
  sql(`CREATE TABLE IF NOT EXISTS health_ai_help (check_id TEXT NOT NULL, hash TEXT NOT NULL, answer_json TEXT NOT NULL, model TEXT, cost REAL, created_at TEXT NOT NULL, PRIMARY KEY (check_id, hash)); DELETE FROM health_ai_help;`);
});
after(() => server?.close());

const pick = (o, fixable) => o.checks.find(x => ['FAIL', 'WARNING'].includes(x.status) && (fixable ? x.fixId && !o.notAutomatic.includes(x.fixId) : (!x.fixId || o.notAutomatic.includes(x.fixId))));

test('3. "Show me how to fix it myself": Claude writes the steps once; the same problem reuses them; "Write again" asks again', async () => {
  const c = pick((await call()).data, false);
  assert.ok(c, 'a problem without an automatic fix (run a full check first if none)');
  const r1 = await call({ action: 'ai_self', checkId: c.id });
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  assert.equal(r1.data.guide.source, 'claude');
  assert.equal(r1.data.guide.steps.length, 3);
  assert.equal(r1.data.guide.steps[0], 'Open Settings › Website Health.', 'numbers removed');
  assert.equal(asked, 1);
  assert.equal((await call({ action: 'ai_self', checkId: c.id })).data.guide.source, 'saved', 'no second payment');
  assert.equal(asked, 1);
  assert.equal((await call({ action: 'ai_self', checkId: c.id, fresh: true })).data.guide.source, 'claude');
  assert.equal(asked, 2);
});

test('1. "Fix it for me" on a problem with no safe fix says so (no AI cost)', async () => {
  const c = pick((await call()).data, false);
  const before = asked;
  const r = await call({ action: 'ai_fix', checkId: c.id });
  assert.equal(r.data.mode, 'cannot');
  assert.equal(asked, before);
});

test('2. "Teach AI": one-time setup steps and a developer request when there is no safe fix; a switch when there is', async () => {
  const o = (await call()).data;
  const c = pick(o, false);
  const r = await call({ action: 'ai_teach', checkId: c.id });
  assert.equal(r.data.mode, 'guide');
  assert.equal(r.data.guide.kind, 'teach');
  assert.match(r.data.developerRequest, new RegExp(c.id));
  const f = pick(o, true);
  if (!f) return; // nothing fixable failing locally right now
  const t = await call({ action: 'ai_teach', checkId: f.id });
  assert.equal(t.data.mode, 'switch');
  assert.equal((await call({ action: 'auto_fix', fixId: f.fixId, enabled: true })).data.enabled, true);
  assert.ok((await call()).data.autoFix.includes(f.fixId));
  assert.equal((await call({ action: 'auto_fix', fixId: f.fixId, enabled: false })).data.enabled, false);
  assert.equal((await call({ action: 'auto_fix', fixId: 'mark_restore_tested', enabled: true })).status, 400, 'never automatic');
});

test('unknown checks, working checks and permissions', async () => {
  assert.equal((await call({ action: 'ai_fix', checkId: 'nope' })).status, 400);
  const o = (await call()).data;
  const okCheck = o.checks.find(x => x.status === 'PASS');
  if (okCheck) assert.equal((await call({ action: 'ai_fix', checkId: okCheck.id })).data.mode, 'nothing');
  const email = `hai-${uid()}@example.com`;
  const made = await fetch(`${BASE}/api/admin/staff`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ name: 'Health AI test', email, password: 'Role-Test-2026!', role: 'matchday_admin' }) }).then(r => r.json());
  const login = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.8.${(Math.random() * 250) | 0}.7` }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
  assert.equal((await call({ action: 'ai_self', checkId: o.checks[0].id }, { Cookie: login.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' })).status, 403, 'Super Admins only');
  await fetch(`${BASE}/api/admin/staff/${made.id}`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ active: false, reason: 'test finished' }) });
});
