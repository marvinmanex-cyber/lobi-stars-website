// SEO Scanner on the server, against a local stand-in for Claude and GitHub (no
// money spent): Super Admins only, keywords (no academy), settings checks, a
// quick scan step by step, issues with their guide and VS Code instruction, AI Fix
// previewed then approved (a GitHub commit to src/data/seo.json) and undone,
// keyword stuffing refused, alt text, ignore with a reason, automation rules
// (automatic refused for titles), Send to developer, history, and the timer.
// Needs the local Pages dev server started with ANTHROPIC_API_KEY,
// ANTHROPIC_BASE_URL=http://127.0.0.1:8899/v1, GITHUB_TOKEN, GITHUB_API_BASE=http://127.0.0.1:8899/gh
// and ANALYTICS_SYNC_FAKE=1 (made-up Search Console and PageSpeed figures).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const CRON = { Authorization: `Bearer ${process.env.CRON_SECRET || 'cron-test-secret'}` };
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;

// ── Stand-in for Anthropic and GitHub ──
const files = new Map(), calls = [];
let stuff = false;
const reply = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ method: req.method, url: req.url, body });
    if (req.url === '/v1/messages') {
      const sys = body.system || '';
      let text = 'ok';
      if (/Google search titles/.test(sys)) text = JSON.stringify(stuff ? { title: 'Lobi Stars tickets Lobi Stars tickets', description: 'Lobi Stars tickets, Lobi Stars tickets, Lobi Stars tickets for every fan in Makurdi.' }
        : { title: 'Aeson Sports: media partner | Lobi Stars FC', description: 'Aeson Sports Management is the official media and broadcast partner of Lobi Stars FC, the Pride of Benue.' });
      else if (/alt text/.test(sys)) text = JSON.stringify(Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`alt${i + 1}`, `Lobi Stars players on the pitch, picture ${i + 1}`])));
      return reply(res, 200, { content: [{ type: 'text', text }], usage: { input_tokens: 300, output_tokens: 60 } });
    }
    const m = req.url.match(/^\/gh\/repos\/[^/]+\/[^/]+\/contents\/([^?]+)/);
    if (m) {
      const path = decodeURIComponent(m[1]);
      if (req.method === 'GET') { const f = files.get(path); return f ? reply(res, 200, { sha: f.sha, content: Buffer.from(f.text).toString('base64') }) : reply(res, 404, {}); }
      if (req.method === 'PUT') { const sha = uid(); files.set(path, { sha, text: Buffer.from(body.content, 'base64').toString('utf8') }); return reply(res, 200, { commit: { sha: `c_${sha}` } }); }
    }
    reply(res, 404, {});
  });
});
before(async () => { await new Promise(r => server.listen(8899, '127.0.0.1', r)); files.set('src/data/seo.json', { sha: 's0', text: '{}\n' }); files.set('src/data/image-alt.json', { sha: 'a0', text: '{}\n' }); });
after(() => server.close());

const api = async (body, q = '', headers = ADMIN) => {
  const r = await fetch(`${BASE}/api/admin/seo${q}`, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers });
  return { status: r.status, d: await r.json().catch(() => ({})) };
};
async function runScan(paths) {
  let { d } = await api({ action: 'scan', kind: 'quick', paths });
  // A scan already running (e.g. the daily one): let it finish first.
  for (let i = 0; i < 600 && d.already; i++) { await api({ action: 'step', id: d.scan.id }); d = (await api({ action: 'scan', kind: 'quick', paths })).d; }
  assert.ok(d.scan?.id, JSON.stringify(d));
  for (let i = 0; i < 100; i++) { const s = (await api({ action: 'step', id: d.scan.id })).d.scan; if (s.done) return s; }
  throw new Error('scan did not finish');
}

test('only the Super Admins: no sign-in, other staff and the bell', async () => {
  assert.equal((await fetch(`${BASE}/api/admin/seo`)).status, 401);
  const email = `seo-${uid()}@example.com`;
  await fetch(`${BASE}/api/admin/staff`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ name: 'SEO Media', email, password: 'Role-Test-2026!', role: 'media' }) });
  const l = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
  const cookie = l.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${BASE}/api/admin/seo`, { headers: { Cookie: cookie } })).status, 403);
  assert.equal((await fetch(`${BASE}/api/admin/seo`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"action":"scan"}' })).status, 403);
  assert.equal((await fetch(`${BASE}/admin/seo/`, { headers: { Cookie: cookie }, redirect: 'manual' })).status !== 200, true);
  assert.equal((await fetch(`${BASE}/admin/seo/`, { headers: ADMIN })).status, 200);
});

test('settings: connections without secrets, keywords (no academy), validation', async () => {
  const { d } = await api(null, '?view=settings');
  assert.ok(d.connections.gsc && d.connections.pagespeed && d.connections.ai);
  assert.ok(!JSON.stringify(d).match(/sk-test-local|gh-test-local|private_key/), 'no secrets in the answer');
  assert.ok(d.keywords.some(k => k.keyword === 'Lobi Stars tickets'));
  assert.ok(!d.keywords.some(k => /academy|women/i.test(k.keyword)));
  assert.equal((await api({ action: 'keyword', keyword: 'Lobi Stars academy' })).status, 400);
  const kw = `Lobi Stars test ${uid()}`;
  assert.equal((await api({ action: 'keyword', keyword: kw, target_path: 'https://lobistarsfc.com/news', priority: 'low' })).status, 200);
  const k = (await api(null, '?view=settings')).d.keywords.find(x => x.keyword === kw);
  assert.equal(k.target_path, '/news/');
  assert.equal((await api({ action: 'keyword_delete', id: k.id })).status, 200);
  assert.equal((await api({ action: 'settings', values: { scan_hour: 25 } })).status, 400);
  assert.equal((await api({ action: 'settings', values: { alert_emails: 'not-an-email' } })).status, 400);
  assert.equal((await api({ action: 'settings', values: { developer_email: 'dev@example.com', ai_daily_limit_usd: 2, scan_hour: 3 } })).status, 200);
  assert.equal((await api({ action: 'competitor', domain: 'lobistarsfc.com' })).status, 400);
});

test('quick scan, issues, guide, AI Fix preview → approve → undo, stuffing refused', async () => {
  const page = '/partners/aeson-sports-management/';
  const s = await runScan([page, '/']);
  assert.ok(s.score >= 0 && s.score <= 100);
  const dash = (await api()).d;
  const issue = dash.issues.find(i => i.path === page && i.type === 'title_length');
  assert.ok(issue, 'the 68-character title is found');
  assert.equal(issue.actions.ai, true);
  const g = (await api(null, `?view=issue&id=${encodeURIComponent(issue.id)}`)).d;
  assert.ok(g.guide.steps.length && g.guide.help.startsWith('https://developers.google.com'));
  // Keyword stuffing from the AI is not used.
  stuff = true;
  const bad = await api({ action: 'prepare', issueId: issue.id });
  assert.equal(bad.status, 400);
  assert.match(bad.d.error, /stuffing/);
  stuff = false;
  const p = await api({ action: 'prepare', issueId: issue.id });
  assert.equal(p.status, 200, JSON.stringify(p.d));
  const fix = p.d.fix;
  assert.equal(fix.status, 'proposed');
  assert.equal(fix.proposal.kind, 'seo_meta');
  assert.match(fix.proposal.preview.before.title, /Aeson Sports Management Limited/);
  assert.equal(files.get('src/data/seo.json').text, '{}\n', 'nothing changes before Approve');
  // Approve with an edit; a bad edit is refused.
  assert.equal((await api({ action: 'apply', fixId: fix.id, edited: { title: 'x' } })).status, 400);
  const a = await api({ action: 'apply', fixId: fix.id, edited: { title: 'Aeson Sports: broadcast partner | Lobi Stars FC' } });
  assert.equal(a.status, 200, JSON.stringify(a.d));
  const seo = JSON.parse(files.get('src/data/seo.json').text);
  assert.equal(seo[page].title, 'Aeson Sports: broadcast partner | Lobi Stars FC');
  assert.match(seo[page].description, /official media and broadcast partner/);
  assert.equal((await api({ action: 'apply', fixId: fix.id })).status, 409, 'not applied twice');
  const hist = (await api(null, '?view=history')).d.fixes;
  const h = hist.find(x => x.id === fix.id);
  assert.ok(h && h.undoable && h.metrics.before);
  const u = await api({ action: 'undo', fixId: fix.id });
  assert.equal(u.status, 200, JSON.stringify(u.d));
  assert.equal(JSON.parse(files.get('src/data/seo.json').text)[page], undefined, 'undo puts the file back');
  // The AI call was recorded under the SEO Scanner's own feature.
  assert.ok((await api(null, '?view=settings')).d.usage.todayCalls >= 2);
});

test('code-level issues get a VS Code instruction (nothing changes); ignore needs a reason; send to developer', async () => {
  const dash = (await api()).d;
  const code = dash.issues.find(i => i.actions.code);
  if (code) {
    const p = await api({ action: 'prepare', issueId: code.id });
    assert.equal(p.status, 200, JSON.stringify(p.d));
    assert.equal(p.d.fix.status, 'instruction');
    assert.match(p.d.fix.proposal.vscode, /npm run build/);
    const dev = await api({ action: 'developer', issueId: code.id });
    assert.ok([200, 400].includes(dev.status), 'sent, or email not set up locally');
  }
  const any = dash.issues[0];
  assert.equal((await api({ action: 'ignore', issueId: any.id, reason: '' })).status, 400);
  assert.equal((await api({ action: 'ignore', issueId: any.id, reason: 'Checked: fine for now' })).status, 200);
  assert.ok((await api()).d.ignored.some(i => i.id === any.id && i.ignoredReason === 'Checked: fine for now'));
  assert.equal((await api({ action: 'unignore', issueId: any.id })).status, 200);
});

test('automation rules: automatic only for safe types', async () => {
  assert.equal((await api({ action: 'rule', type: 'title_length', mode: 'auto' })).status, 400);
  assert.equal((await api({ action: 'rule', type: 'h1_missing', mode: 'approve' })).status, 400, 'code-level: no rule');
  assert.equal((await api({ action: 'rule', type: 'img_alt', mode: 'auto', scope: 'news', daily_max: 3, notify: 'bell' })).status, 200);
  assert.equal((await api({ action: 'rule', type: 'title_length', mode: 'approve', scope: 'all', daily_max: 99 })).status, 200);
  const r = (await api(null, '?view=settings')).d.rules;
  assert.equal(r.find(x => x.type === 'img_alt').mode, 'auto');
  assert.equal(r.find(x => x.type === 'title_length').daily_max, 50, 'at most 50 a day');
  await api({ action: 'rule', type: 'img_alt', mode: 'off' });
  await api({ action: 'rule', type: 'title_length', mode: 'off' });
});

test('the timer: the cron call steps the SEO Scanner when Website Health is idle', async () => {
  const r = await fetch(`${BASE}/api/internal/health-check`, { method: 'POST', headers: CRON }).then(x => x.json());
  assert.equal(r.ok, true);
  assert.ok('more' in r);
});
