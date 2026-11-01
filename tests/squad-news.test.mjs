// Squad Phase 7 (news): names found in published stories become tag
// suggestions; one click tags the story (the news file is written again via
// GitHub) or dismisses it; tagged stories give AI fact suggestions that wait in
// Squad: Approvals; approved facts go to the partner feed (Data Package 1.5).
// A local stand-in on :8899 plays GitHub (/gh) and Claude (/v1).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { sql } from './media-helpers.mjs';
import { addToFrontMatter, mentioned } from '../functions/api/_lib/squadNews.js';
import { validatePackage } from '../src/lib/squadPackage.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const CRON = { Authorization: `Bearer ${process.env.CRON_SECRET || 'cron-test-secret'}` };
const KEY = process.env.LOBI_PARTNER_API_KEY || 'partner-test-key';
const T = Math.random().toString(36).slice(2, 7).replace(/\d/g, 'n');
const rows = q => JSON.parse(sql(q))[0].results;
let P, NAME, srv; const blobs = new Map(), commits = []; let seq = 0, claudeCalls = 0;
const admin = (p, body) => fetch(`${BASE}/api/admin/${p}`, body ? { method: 'POST', headers: ADMIN, body: JSON.stringify(body) } : { headers: ADMIN }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const tick = () => { sql(`DELETE FROM mc_settings WHERE key = 'newslink_last';`); return fetch(`${BASE}/api/internal/newsletter-run`, { method: 'POST', headers: CRON }).then(r => r.json()); };
const story = (slug, title, body) => {
  const v = { category: 'Match Report', headline: title, summary: 'A test story.', cover: { url: '/api/media-file/f_testcover', id: 'f_testcover' }, caption: 'Test', credit: '', body, gallery: [], video: '', players: [], staff: [], match: null, breaking: false, breakingRequested: false, author: '' };
  sql(`INSERT INTO mc_items (id, kind, status, title, slug, data_json, live_json, created_by, created_by_name, created_at, updated_at, published_at)
    VALUES ('news_${slug}', 'news', 'published', '${title.replace(/'/g, "''")}', '${slug}', '${JSON.stringify(v).replace(/'/g, "''")}', '${JSON.stringify(v).replace(/'/g, "''")}', 'test', 'News Tester', '${new Date().toISOString()}', '${new Date().toISOString()}', '${new Date().toISOString()}');`);
};

before(async () => {
  srv = http.createServer((req, res) => {
    let body = ''; req.on('data', c => { body += c; }); req.on('end', () => {
      const send = (d, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
      const b = body ? JSON.parse(body) : {};
      if (req.url.startsWith('/v1/messages')) { claudeCalls++; return send({ content: [{ type: 'text', text: JSON.stringify({ facts: `2026-10-25 | Scored twice against Kada City on 25 Oct 2026 (${T})` }) }], usage: { input_tokens: 100, output_tokens: 30 } }); }
      if (req.method === 'POST' && req.url.endsWith('/git/blobs')) { const sha = `b${++seq}`; blobs.set(sha, Buffer.from(b.content, b.encoding === 'base64' ? 'base64' : 'utf8')); return send({ sha }, 201); }
      if (req.method === 'GET' && /\/git\/ref\/heads\//.test(req.url)) return send({ object: { sha: 'head1' } });
      if (req.method === 'GET' && /\/git\/commits\//.test(req.url)) return send({ tree: { sha: 'tree0' } });
      if (req.method === 'POST' && req.url.endsWith('/git/trees')) { commits.push(b.tree); return send({ sha: `t${++seq}` }, 201); }
      if (req.method === 'POST' && req.url.endsWith('/git/commits')) return send({ sha: `c${++seq}` }, 201);
      if (req.method === 'PATCH') return send({ ok: true });
      send({ message: 'not found' }, 404);
    });
  }).listen(8899, '127.0.0.1');
  P = rows(`SELECT id, person_id, public_slug, data_json FROM squad_profiles WHERE type = 'player' AND status = 'LIVE' AND public_slug IS NOT NULL ORDER BY public_slug LIMIT 1;`)[0];
  const d = JSON.parse(P.data_json); NAME = `${d.firstName} ${d.surname}`;
  story(`t1-${T}`, `Big win ${T}`, `<p>${NAME} scored twice in the second half.</p>`);
  story(`t2-${T}`, `Training ${T}`, `<p>Someone called ${NAME} was mentioned here by mistake.</p>`);
});
after(() => {
  srv?.close();
  sql(`DELETE FROM mc_items WHERE id IN ('news_t1-${T}', 'news_t2-${T}'); DELETE FROM squad_tag_suggestions WHERE article_slug IN ('t1-${T}', 't2-${T}');
    DELETE FROM squad_fact_runs WHERE article_slug IN ('t1-${T}', 't2-${T}'); DELETE FROM squad_requests WHERE kind = 'fact' AND payload_json LIKE '%${T}%'; DELETE FROM squad_facts WHERE text LIKE '%${T}%';
    DELETE FROM mc_settings WHERE key = 'newslink_last';`);
});

test('the helpers: whole-name matches; adding a tag to any front-matter list style', () => {
  assert.equal(mentioned('Great game by Musa Adeyemi today', ['Musa Adeyemi']), 'Musa Adeyemi');
  assert.equal(mentioned('Musa Adeyemisson played', ['Musa Adeyemi']), null, 'whole words only');
  assert.match(addToFrontMatter('---\ntitle: "x"\n---\nbody', 'players', 'a-b'), /^players: \["a-b"\]$/m);
  assert.match(addToFrontMatter('---\ntitle: "x"\nplayers: ["c-d"]\n---\n', 'players', 'a-b'), /^players: \["c-d","a-b"\]$/m);
  assert.match(addToFrontMatter('---\ntitle: x\nplayers:\n  - c-d\n  - e-f\nsummary: y\n---\n', 'players', 'a-b'), /^players: \["c-d","e-f","a-b"\]\nsummary: y$/m);
  assert.match(addToFrontMatter('---\nplayers: null\n---\n', 'staff', 'g-h'), /^staff: \["g-h"\]$/m);
});

test('mentions become suggestions; Tag updates the story, Not this person dismisses', async () => {
  const run = await tick();
  assert.ok(run.media.newsLinks?.mentions?.suggested >= 2, JSON.stringify(run.media));
  const list = (await admin('squad-suggestions')).data.suggestions.filter(s => s.article_slug.endsWith(T));
  assert.equal(list.length, 2);
  const one = list.find(s => s.article_slug === `t1-${T}`), two = list.find(s => s.article_slug === `t2-${T}`);
  assert.equal(one.slug, P.public_slug); assert.equal(one.matched.toLowerCase(), NAME.toLowerCase());
  const r = await admin('squad-suggestions', { id: one.id, decision: 'tag' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const md = blobs.get(commits[commits.length - 1].find(x => x.path === `src/content/news/t1-${T}.md`).sha).toString();
  assert.match(md, new RegExp(`^players: \\["${P.public_slug}"\\]$`, 'm'), 'the news file now tags the player');
  assert.ok(JSON.parse(rows(`SELECT live_json FROM mc_items WHERE id = 'news_t1-${T}';`)[0].live_json).players.includes(P.public_slug));
  assert.equal((await admin('squad-suggestions', { id: two.id, decision: 'dismiss' })).status, 200);
  assert.equal((await admin('squad-suggestions', { id: two.id, decision: 'tag' })).status, 409, 'already decided');
  await tick();
  assert.equal((await admin('squad-suggestions')).data.suggestions.filter(s => s.article_slug.endsWith(T)).length, 0, 'never suggested again');
});

test('AI fact suggestions from a tagged story wait in Squad: Approvals; approved facts reach the partner feed (1.5)', async () => {
  assert.ok(claudeCalls >= 1, 'Claude was asked about the tagged story');
  const q = (await admin('squad-approvals')).data;
  const item = (q.items || []).find(i => i.kind === 'fact' && JSON.stringify(i).includes(T));
  assert.ok(item, 'the suggested fact is in the Approval Queue');
  const a = await admin('squad-approvals', { action: 'request', requestId: item.requestId, decision: 'approve' });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  const doc = await fetch(`${BASE}/api/partner/squad`, { headers: { Authorization: `Bearer ${KEY}` } }).then(r => r.json());
  assert.equal(doc.schemaVersion, '1.5'); assert.deepEqual(validatePackage(doc), []);
  const me = doc.players.find(p => p.id === P.id);
  assert.ok(me.verifiedFacts.some(f => f.text.includes(T) && f.date === '2026-10-25' && /\/news\/t1-/.test(f.source)));
  const pub = await fetch(`${BASE}/api/squad/public`).then(r => r.json());
  assert.ok(!JSON.stringify(pub).includes(T), 'AI facts are never on the public website');
});
