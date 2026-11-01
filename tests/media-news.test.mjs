// Media Centre, phase 2: Latest News. Write, upload, safe rich text, submit,
// return with comment, approve (edit then approve), publish to GitHub (a local
// stand-in records the commit), corrections, scheduled publishing, unpublish.
// Needs the local server started with GITHUB_TOKEN and GITHUB_API_BASE=http://127.0.0.1:8899/gh.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { sql } from './media-helpers.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const CRON = { Authorization: `Bearer ${process.env.CRON_SECRET || 'cron-test-secret'}` };
const uid = () => Math.random().toString(36).slice(2, 8);
const T = uid().replace(/\d/g, 'z');
const LOGIN = `Newsy${T}${String(Math.floor(Math.random() * 90) + 10)}`;
const admin = (p, body) => fetch(`${BASE}/api/admin/media-centre/${p}`, body ? { method: 'POST', headers: ADMIN, body: JSON.stringify(body) } : { headers: ADMIN }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
let S, gh, blobs = new Map(), commits = [], seq = 0;
const mc = (p, method = 'GET', body) => fetch(`${BASE}/api/media-centre/${p}`, { method, headers: { Cookie: S.cookie, 'X-CSRF-Token': S.csrf, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined })
  .then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const jpg = readFileSync(new URL('../public/images/lobi-stars-badge-print.jpg', import.meta.url));
const photo = async () => { const f = new FormData(); f.append('file', new Blob([jpg], { type: 'image/jpeg' }), 'p.jpg'); f.append('kind', 'image'); f.append('width', '600'); f.append('height', '400'); return (await mc('upload', 'POST', f)).data.file; };

before(async () => {
  // GitHub stand-in: blobs, trees, commits, refs.
  gh = http.createServer((req, res) => {
    let body = ''; req.on('data', c => { body += c; }); req.on('end', () => {
      const send = (d, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
      const b = body ? JSON.parse(body) : {};
      if (req.method === 'POST' && req.url.endsWith('/git/blobs')) { const sha = `b${++seq}`; blobs.set(sha, b.encoding === 'base64' ? Buffer.from(b.content, 'base64') : Buffer.from(b.content)); return send({ sha }, 201); }
      if (req.method === 'GET' && /\/git\/ref\/heads\//.test(req.url)) return send({ object: { sha: 'head1' } });
      if (req.method === 'GET' && /\/git\/commits\//.test(req.url)) return send({ tree: { sha: 'tree0' } });
      if (req.method === 'POST' && req.url.endsWith('/git/trees')) { commits.push({ tree: b.tree }); return send({ sha: `t${++seq}` }, 201); }
      if (req.method === 'POST' && req.url.endsWith('/git/commits')) { commits[commits.length - 1].message = b.message; return send({ sha: `c${++seq}` }, 201); }
      if (req.method === 'PATCH' && /\/git\/refs\/heads\//.test(req.url)) return send({ ok: true });
      send({ message: 'not found' }, 404);
    });
  }).listen(8899, '127.0.0.1');
  const c = await admin('users', { action: 'create', loginId: LOGIN, fullName: 'Nancy Newsy', password: 'Temp-pass-123' });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  let r = await fetch(`${BASE}/api/media-centre/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: LOGIN, password: 'Temp-pass-123' }) });
  S = { cookie: r.headers.get('set-cookie').match(/ls_media=[^;]+/)[0], csrf: (await r.json()).csrf };
  assert.equal((await mc('password', 'POST', { current: 'Temp-pass-123', password: 'Own-pass-456' })).status, 200);
});
after(() => {
  gh?.close();
  sql(`DELETE FROM mc_revisions WHERE item_id IN (SELECT id FROM mc_items WHERE created_by_name = 'Nancy Newsy'); DELETE FROM mc_items WHERE created_by_name = 'Nancy Newsy'; DELETE FROM mc_files WHERE uploaded_by_name = 'Nancy Newsy'; DELETE FROM mc_sessions WHERE user_id IN (SELECT id FROM mc_users WHERE login_key = '${LOGIN.toLowerCase()}'); DELETE FROM mc_users WHERE login_key = '${LOGIN.toLowerCase()}';`);
});
const lastFile = re => { for (let i = commits.length - 1; i >= 0; i--) { const f = commits[i].tree.find(x => re.test(x.path)); if (f) return { path: f.path, text: blobs.get(f.sha).toString() }; } return null; };

test('uploads: only real pictures and documents, at most 5 MB', async () => {
  const f = new FormData(); f.append('file', new Blob(['<script>alert(1)</script>'.repeat(10)], { type: 'image/jpeg' }), 'x.jpg'); f.append('kind', 'image');
  assert.equal((await mc('upload', 'POST', f)).status, 400, 'not really a picture');
  const big = new FormData(); big.append('file', new Blob([new Uint8Array(5 * 1024 * 1024 + 10).fill(0xff)], { type: 'image/jpeg' }), 'big.jpg'); big.append('kind', 'image');
  assert.equal((await mc('upload', 'POST', big)).status, 400, 'over 5 MB');
  const ok = await photo();
  assert.match(ok.url, /^\/api\/media-file\/[a-z0-9_]+$/);
  assert.equal((await fetch(`${BASE}${ok.url}`)).status, 404, 'private: not for the public');
  assert.equal((await fetch(`${BASE}${ok.url}`, { headers: { Cookie: S.cookie } })).status, 200);
});

let story;
test('the editor: categories, tags and safe rich text (scripts and event handlers removed)', async () => {
  const m = (await mc('meta')).data;
  assert.equal(m.categories.length, 17); assert.ok(m.categories.includes("Coach's Corner"));
  assert.ok(Array.isArray(m.players) && Array.isArray(m.matches));
  story = (await mc('items', 'POST', { kind: 'news', data: { category: 'Match Report' } })).data.id;
  const cover = await photo();
  const r = await mc(`items/${story}`, 'PUT', { data: {
    category: 'Match Report', headline: '<script>alert(1)</script>Lobi Stars beat Kada City', summary: 'A late goal settled it in Makurdi on Sunday afternoon.',
    cover, caption: 'Captain lifts the fans', credit: 'Lobi Media',
    body: '<p>Great <b>win</b>.<script>alert(1)</script></p><img src="x" onerror="alert(1)"><p onclick="alert(1)">More text here for the readers <a href="javascript:alert(1)">bad</a> <a href="https://lobistarsfc.com/">good</a>.</p><iframe src="https://evil"></iframe>',
    players: ['musa-adeyemi'], video: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', breaking: true, breakingRequested: true,
  } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const it = (await mc(`items/${story}`)).data.item;
  assert.doesNotMatch(it.data.body, /script|onerror|onclick|javascript:|iframe/i);
  assert.match(it.data.body, /<b>win<\/b>/); assert.match(it.data.body, /href="https:\/\/lobistarsfc.com\/"/);
  assert.equal(it.data.breaking, false, 'only a Super Admin can switch breaking news on');
  assert.equal(it.data.breakingRequested, true);
  assert.equal((await mc(`items/${story}`, 'PUT', { data: { ...it.data, video: 'https://evil.example/v' } })).status, 400, 'video links: YouTube or Facebook only');
});

test('submit, return with a comment (shown on the dashboard), submit again', async () => {
  const empty = (await mc('items', 'POST', { kind: 'news', data: {} })).data.id;
  assert.equal((await mc(`items/${empty}`, 'POST', { action: 'submit' })).status, 400, 'incomplete stories cannot be sent');
  assert.equal((await mc(`items/${empty}`, 'POST', { action: 'delete_draft' })).status, 200);
  assert.equal((await mc(`items/${story}`, 'POST', { action: 'submit' })).status, 200);
  assert.equal((await mc(`items/${story}`, 'PUT', { data: { headline: 'x' } })).status, 409, 'locked while waiting');
  const q = (await admin('approvals')).data.items;
  assert.ok(q.some(i => i.id === story));
  assert.equal((await admin('approvals', { id: story, decision: 'return', comment: '' })).status, 400, 'a comment is needed');
  assert.equal((await admin('approvals', { id: story, decision: 'return', comment: 'Add the scorer, please.' })).status, 200);
  const dash = (await mc('dashboard')).data;
  const back = dash.returned.find(i => i.id === story);
  assert.ok(back); assert.equal(back.comment, 'Add the scorer, please.');
  const it = (await mc(`items/${story}`)).data.item;
  assert.equal((await mc(`items/${story}`, 'PUT', { data: { ...it.data, body: `${it.data.body}<p>Scorer: Terna Akaa (88').</p>` } })).status, 200);
  assert.equal((await mc(`items/${story}`, 'POST', { action: 'submit' })).status, 200);
});

test('edit then approve: published to the News page through GitHub (story and photo in one commit)', async () => {
  const detail = (await admin(`approvals?id=${story}`)).data;
  assert.ok(detail.previewHtml.includes('Lobi Stars beat'));
  assert.ok(!/<script>/.test(detail.previewHtml), 'headline escaped in the preview');
  assert.ok(detail.revisions.length >= 2, 'versions kept');
  const r = await admin('approvals', { id: story, decision: 'approve', data: { ...detail.item.data, headline: 'Lobi Stars beat Kada City 1-0', breaking: true } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.published, true);
  const md = lastFile(/^src\/content\/news\/.+\.md$/);
  assert.ok(md, 'news file committed');
  assert.match(md.path, /^src\/content\/news\/\d{4}-\d{2}-\d{2}-lobi-stars-beat-kada-city-1-0\.md$/);
  assert.match(md.text, /^title: "Lobi Stars beat Kada City 1-0"$/m);
  assert.match(md.text, /^category: "Match Report"$/m); assert.match(md.text, /^newsTab: "Team News"$/m);
  assert.match(md.text, /^isBanner: true$/m, 'breaking news (homepage banner)');
  assert.match(md.text, /^coverImage: "\/images\/news\/mc\/[a-z0-9_]+\.jpg"$/m);
  assert.match(md.text, /^mcId: "/m); assert.match(md.text, /^players: \["musa-adeyemi"\]$/m);
  assert.doesNotMatch(md.text, /api\/media-file/, 'photos point at the committed copies');
  assert.ok(commits[commits.length - 1].tree.some(x => /^public\/images\/news\/mc\/.+\.jpg$/.test(x.path)), 'the photo in the same commit');
  const it = (await mc(`items/${story}`)).data.item;
  assert.equal(it.status, 'published'); assert.ok(it.slug);
});

test('a correction keeps the live version until it is approved', async () => {
  const it = (await mc(`items/${story}`)).data.item;
  const r = await mc(`items/${story}`, 'PUT', { data: { ...it.data, summary: 'Corrected: a late goal settled it in Makurdi.' } });
  assert.equal(r.status, 200); assert.equal(r.data.correction, true);
  const after = (await mc(`items/${story}`)).data.item;
  assert.equal(after.status, 'published'); assert.equal(after.correction, 'draft');
  assert.equal(after.live.summary, 'A late goal settled it in Makurdi on Sunday afternoon.', 'live version unchanged');
  const n = commits.length;
  assert.equal((await mc(`items/${story}`, 'POST', { action: 'submit' })).status, 200);
  assert.equal(commits.length, n, 'nothing published before approval');
  assert.equal((await admin('approvals', { id: story, decision: 'approve' })).status, 200);
  const md = lastFile(/^src\/content\/news\/.+\.md$/);
  assert.match(md.text, /Corrected: a late goal/); assert.match(md.text, /^updatedAt: /m);
  assert.ok(!commits[commits.length - 1].tree.some(x => x.path.endsWith('.jpg')), 'the photo is not sent again');
});

test('scheduled publishing, then unpublish (never deleted)', async () => {
  const id = (await mc('items', 'POST', { kind: 'news', data: {} })).data.id;
  const cover = await photo();
  await mc(`items/${id}`, 'PUT', { data: { category: 'Club Announcements', headline: 'Membership week starts on Monday', summary: 'Join the club this week and get a free scarf.', cover, caption: 'Scarves', body: '<p>Everything about membership week, with all the details fans need.</p>' } });
  assert.equal((await mc(`items/${id}`, 'POST', { action: 'submit', scheduledAt: new Date(Date.now() - 60e3).toISOString() })).status, 400, 'a time in the past');
  assert.equal((await mc(`items/${id}`, 'POST', { action: 'submit', scheduledAt: new Date(Date.now() + 3 * 3600e3).toISOString() })).status, 200);
  const r = await admin('approvals', { id, decision: 'approve' });
  assert.equal(r.status, 200); assert.equal(r.data.scheduled, true);
  sql(`UPDATE mc_items SET scheduled_at = '${new Date(Date.now() - 60e3).toISOString()}' WHERE id = '${id}';`);
  const tick = await fetch(`${BASE}/api/internal/newsletter-run`, { method: 'POST', headers: CRON }).then(x => x.json());
  assert.equal(tick.media.scheduled.published, 1, JSON.stringify(tick));
  assert.match(lastFile(/membership-week/).text, /^status: published$/m);
  assert.equal((await admin('approvals', { id, decision: 'unpublish' })).status, 200);
  assert.match(lastFile(/membership-week/).text, /^status: draft$/m);
  assert.equal((await mc(`items/${id}`, 'POST', { action: 'delete_draft' })).status, 409, 'published content is never deleted');
  const left = JSON.parse(sql(`SELECT status FROM mc_items WHERE id = '${id}';`))[0].results[0];
  assert.equal(left.status, 'unpublished');
});

test('every step is in the activity log', async () => {
  const rows = (await admin('activity?section=news')).data.rows.filter(r => r.item_id === story || /Nancy Newsy/.test(r.actor_name || ''));
  const acts = new Set(rows.map(r => r.action));
  for (const a of ['create', 'edit', 'submit', 'return', 'approve']) assert.ok(acts.has(a), `logged: ${a}`);
  const all = new Set((await admin('activity')).data.rows.map(r => r.action));
  for (const a of ['upload', 'unpublish', 'publish_scheduled', 'delete_draft']) assert.ok(all.has(a), `logged: ${a}`);
});
