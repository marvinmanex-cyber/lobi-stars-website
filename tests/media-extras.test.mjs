// Media Centre, phase 5: press releases, Matchday Desk (line-ups, live updates,
// pre-approved grants), Photo & Video Library (albums -> Gallery), interview
// requests, press kit, content calendar.
// Needs the local server with GITHUB_TOKEN and GITHUB_API_BASE=http://127.0.0.1:8899/gh.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { sql } from './media-helpers.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const CRON = { Authorization: `Bearer ${process.env.CRON_SECRET || 'cron-test-secret'}` };
const T = Math.random().toString(36).slice(2, 8).replace(/\d/g, 'x');
const LOGIN = `Extra${T}${String(Math.floor(Math.random() * 90) + 10)}`;
const EV = `ext-${T}`;
const admin = (p, body) => fetch(`${BASE}/api/admin/media-centre/${p}`, body ? { method: 'POST', headers: ADMIN, body: JSON.stringify(body) } : { headers: ADMIN }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
let S, userId, gh; const blobs = new Map(), commits = []; let seq = 0;
const mc = (p, method = 'GET', body) => fetch(`${BASE}/api/media-centre/${p}`, { method, headers: { Cookie: S.cookie, 'X-CSRF-Token': S.csrf, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined })
  .then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const jpg = readFileSync(new URL('../public/images/lobi-stars-badge-print.jpg', import.meta.url));
const up = async (kind = 'image') => { const f = new FormData(); f.append('file', kind === 'image' ? new Blob([jpg], { type: 'image/jpeg' }) : new Blob([Buffer.from('%PDF-1.4\n' + 'y'.repeat(300))], { type: 'application/pdf' }), kind === 'image' ? 'p.jpg' : 'facts.pdf'); f.append('kind', kind); return (await mc('upload', 'POST', f)).data.file; };
const make = async (kind, data) => { const id = (await mc('items', 'POST', { kind, data })).data.id; return id; };
const lastFile = re => { for (let i = commits.length - 1; i >= 0; i--) { const f = commits[i].tree.find(x => re.test(x.path)); if (f) return { path: f.path, text: blobs.get(f.sha).toString() }; } return null; };

before(async () => {
  gh = http.createServer((req, res) => {
    let body = ''; req.on('data', c => { body += c; }); req.on('end', () => {
      const send = (d, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
      const b = body ? JSON.parse(body) : {};
      if (req.method === 'POST' && req.url.endsWith('/git/blobs')) { const sha = `b${++seq}`; blobs.set(sha, b.encoding === 'base64' ? Buffer.from(b.content, 'base64') : Buffer.from(b.content)); return send({ sha }, 201); }
      if (req.method === 'GET' && /\/git\/ref\/heads\//.test(req.url)) return send({ object: { sha: 'head1' } });
      if (req.method === 'GET' && /\/git\/commits\//.test(req.url)) return send({ tree: { sha: 'tree0' } });
      if (req.method === 'POST' && req.url.endsWith('/git/trees')) { commits.push({ tree: b.tree }); return send({ sha: `t${++seq}` }, 201); }
      if (req.method === 'POST' && req.url.endsWith('/git/commits')) return send({ sha: `c${++seq}` }, 201);
      if (req.method === 'PATCH') return send({ ok: true });
      send({ message: 'not found' }, 404);
    });
  }).listen(8899, '127.0.0.1');
  sql(`INSERT INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo, active) VALUES ('${EV}', 'Lobi Stars FC', 'Extra City ${T}', 'NNL', '${new Date(Date.now() + 3 * 86400e3).toISOString()}', 'McCarthy Stadium, Makurdi', 1, 1, 1, 1);`);
  const c = await admin('users', { action: 'create', loginId: LOGIN, fullName: 'Ezra Extra', password: 'Temp-pass-123' });
  assert.equal(c.status, 200); userId = c.data.id;
  const r = await fetch(`${BASE}/api/media-centre/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: LOGIN, password: 'Temp-pass-123' }) });
  S = { cookie: r.headers.get('set-cookie').match(/ls_media=[^;]+/)[0], csrf: (await r.json()).csrf };
  await mc('password', 'POST', { current: 'Temp-pass-123', password: 'Own-pass-456' });
});
after(() => {
  gh?.close();
  sql(`DELETE FROM mc_revisions WHERE item_id IN (SELECT id FROM mc_items WHERE created_by_name = 'Ezra Extra'); DELETE FROM mc_items WHERE created_by_name = 'Ezra Extra';
    DELETE FROM match_centre WHERE event_id = '${EV}'; DELETE FROM mc_live_grants WHERE event_id = '${EV}'; DELETE FROM events WHERE id = '${EV}';
    DELETE FROM mc_interviews WHERE email LIKE '%.${T}@example.com'; DELETE FROM mc_contacts WHERE email LIKE '%.${T}@example.com'; DELETE FROM mc_calendar WHERE created_by = 'Ezra Extra';
    DELETE FROM mc_files WHERE uploaded_by_name = 'Ezra Extra'; DELETE FROM mc_sessions WHERE user_id = '${userId}'; DELETE FROM mc_users WHERE id = '${userId}';`);
});

test('press release: fixed layout, approved, on the Press Releases page with a PDF', async () => {
  const id = await make('press', { date: new Date().toISOString().slice(0, 10) });
  assert.equal((await mc(`items/${id}`, 'POST', { action: 'submit' })).status, 400, 'incomplete');
  await mc(`items/${id}`, 'PUT', { data: { headline: `Club statement ${T}`, date: new Date().toISOString().slice(0, 10), location: 'MAKURDI', body: '<p>Lobi Stars FC confirms the appointment of a new kit partner for the rest of the season, starting this weekend.</p><script>x()</script>', quote: 'We are delighted.', quoteBy: 'Chairman' } });
  assert.equal((await mc(`items/${id}`, 'POST', { action: 'submit' })).status, 200);
  const r = await admin('approvals', { id, decision: 'approve' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const slug = JSON.parse(sql(`SELECT slug FROM mc_items WHERE id = '${id}';`))[0].results[0].slug;
  const list = await fetch(`${BASE}/media/press-releases/`).then(x => x.text());
  assert.ok(list.includes(`Club statement ${T}`), 'listed');
  const page = await fetch(`${BASE}/media/press-releases/${slug}/`).then(x => x.text());
  for (const s of ['FOR IMMEDIATE RELEASE', 'ENDS', 'Media contact', 'We are delighted', 'MAKURDI']) assert.ok(page.includes(s), `page shows ${s}`);
  assert.ok(!page.includes('x()'), 'body cleaned');
  const pdf = await fetch(`${BASE}/media/press-releases/${slug}.pdf`);
  assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.ok(Buffer.from(await pdf.arrayBuffer()).toString('latin1').includes('ENDS'));
});

test('Matchday Desk: line-up approved and published at its time; live updates need approval unless granted', async () => {
  const starters = Array.from({ length: 11 }, (_, i) => ({ slug: `p${i}-${T}`, name: `Player ${i + 1}`, number: i + 1, position: 'MF' }));
  const lid = await make('lineup', { eventId: EV, label: `Lobi Stars FC v Extra City ${T}`, starting: starters.slice(0, 10), subs: [] });
  assert.match((await mc(`items/${lid}`, 'POST', { action: 'submit' })).data.error, /exactly 11/);
  await mc(`items/${lid}`, 'PUT', { data: { eventId: EV, label: `Lobi Stars FC v Extra City ${T}`, starting: starters, subs: [{ slug: 'sub', name: 'Sub One', number: 12 }], formation: '4-3-3' } });
  assert.equal((await mc(`items/${lid}`, 'POST', { action: 'submit', scheduledAt: new Date(Date.now() + 3600e3).toISOString() })).status, 200);
  assert.equal((await admin('approvals', { id: lid, decision: 'approve' })).data.scheduled, true);
  sql(`UPDATE mc_items SET scheduled_at = '${new Date(Date.now() - 60e3).toISOString()}' WHERE id = '${lid}';`);
  await fetch(`${BASE}/api/internal/newsletter-run`, { method: 'POST', headers: CRON });
  const lu = JSON.parse(JSON.parse(sql(`SELECT lineups_json FROM match_centre WHERE event_id = '${EV}';`))[0].results[0].lineups_json);
  assert.equal(lu.home.starting.length, 11); assert.equal(lu.home.subs[0], 'Sub One');
  // Without a grant: waits for approval.
  let r = await mc('live', 'POST', { eventId: EV, update: { type: 'goal', minute: '12', team: 'home', player: 'Player 9' } });
  assert.equal(r.status, 200); assert.equal(r.data.waiting, true);
  const q = (await admin('approvals')).data.items.find(i => i.kind === 'live' && i.title.includes('Player 9'));
  assert.ok(q, 'in the Approval Queue');
  assert.equal((await admin('approvals', { id: q.id, decision: 'approve' })).status, 200);
  let mcRow = JSON.parse(sql(`SELECT home_score, away_score FROM match_centre WHERE event_id = '${EV}';`))[0].results[0];
  assert.equal(mcRow.home_score, 1);
  // With a grant: posts at once.
  assert.equal((await admin('grants', { action: 'grant', eventId: EV, userId })).status, 200);
  r = await mc('live', 'POST', { eventId: EV, update: { type: 'goal', minute: '30', team: 'home', player: 'Player 10' } });
  assert.equal(r.data.posted, true); assert.equal(r.data.score, '2-0');
  assert.equal((await mc('live', 'POST', { eventId: EV, update: { type: 'goal', minute: '31' } })).status, 400, 'team and player needed');
  r = await mc('live', 'POST', { eventId: EV, update: { type: 'halftime' } });
  assert.equal(r.data.status, 'half-time');
  const state = (await mc(`live?event=${EV}`)).data;
  assert.equal(state.granted, true); assert.ok(state.match.timeline.length >= 3);
  const pub = await fetch(`${BASE}/api/matches/${EV}`).then(x => x.json()).catch(() => null);
  if (pub?.match) assert.equal(pub.match.home_score, 2, 'match page data');
  assert.equal((await admin('grants', { action: 'revoke', eventId: EV, userId })).status, 200);
  const acts = new Set((await admin('activity?section=matchday')).data.rows.map(x => x.action));
  for (const a of ['live_update', 'grant_live_updates', 'revoke_live_updates', 'approve']) assert.ok(acts.has(a), `logged: ${a}`);
});

test('library: an album goes into the Gallery after approval; pictures are reusable', async () => {
  const p1 = await up(), p2 = await up();
  const id = await make('album', { title: `Matchday ${T}`, date: new Date().toISOString().slice(0, 10), credit: 'Lobi Media', photos: [{ url: p1.url, caption: 'The team' }, { url: p2.url, caption: '' }], videos: [] });
  assert.match((await mc(`items/${id}`, 'POST', { action: 'submit' })).data.error, /Photo 2 needs a caption/);
  await mc(`items/${id}`, 'PUT', { data: { title: `Matchday ${T}`, date: new Date().toISOString().slice(0, 10), credit: 'Lobi Media', photos: [{ url: p1.url, caption: 'The team', players: ['musa-adeyemi'] }, { url: p2.url, caption: 'The fans' }], videos: [{ url: 'https://youtu.be/dQw4w9WgXcQ', caption: 'Highlights' }] } });
  assert.equal((await mc(`items/${id}`, 'POST', { action: 'submit' })).status, 200);
  assert.equal((await admin('approvals', { id, decision: 'approve' })).status, 200);
  const md = lastFile(new RegExp(`^src/content/gallery/.*matchday-${T}-01\\.md$`));
  assert.ok(md, 'gallery entry committed');
  assert.match(md.text, /^caption: "Matchday .*: The team"$/m); assert.match(md.text, /^credit: "Lobi Media"$/m); assert.match(md.text, /^hidden: false$/m);
  assert.ok(commits[commits.length - 1].tree.some(x => /^public\/images\/gallery\/mc\/.+\.jpg$/.test(x.path)));
  assert.equal((await admin('approvals', { id, decision: 'unpublish' })).status, 200);
  assert.match(lastFile(new RegExp(`matchday-${T}-01\\.md$`)).text, /^hidden: true$/m);
  const lib = (await mc('library')).data.images;
  assert.ok(lib.some(i => i.id === p1.id && i.album === `Matchday ${T}`), 'in the library with its album');
});

test('interview requests: public form, propose a time, approve, done; saved to contacts', async () => {
  const send = b => fetch(`${BASE}/api/media/interview-request`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.9.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}` }, body: JSON.stringify(b) });
  const ft = (await fetch(`${BASE}/api/media/interview-request`).then(x => x.json())).formToken;
  await new Promise(r => setTimeout(r, 3200));
  assert.equal((await send({ fullName: 'X Y', formToken: 'bad.bad.bad' })).status, 400, 'form token needed');
  const base = { formToken: ft, fullName: 'Ifeoma Ask', email: `ife.${T}@example.com`, organisation: 'Radio Benue', who: 'The head coach', topic: 'The season so far and the next home match.', preferredAt: '2026-11-20T10:00', format: 'phone' };
  assert.equal((await send({ ...base, format: 'fax' })).status, 400);
  assert.equal((await send({ ...base, website: 'spam' })).status, 200);
  assert.equal((await send(base)).status, 200);
  const req = (await mc('interviews')).data.requests.find(r => r.email === base.email);
  assert.ok(req); assert.equal(req.status, 'new');
  assert.equal((await mc('interviews', 'POST', { id: req.id, decision: 'propose', at: 'soon' })).status, 400);
  assert.equal((await mc('interviews', 'POST', { id: req.id, decision: 'propose', at: '2026-11-21T11:00', note: 'Saturday works better' })).status, 200);
  assert.equal((await mc('interviews', 'POST', { id: req.id, decision: 'approve' })).status, 200);
  assert.equal((await mc('interviews', 'POST', { id: req.id, decision: 'done' })).status, 200);
  const after = (await mc('interviews')).data.requests.find(r => r.id === req.id);
  assert.equal(after.status, 'done'); assert.ok(after.history.length >= 4);
  const c = (await mc('accreditations?view=contacts')).data.contacts.find(x => x.email === base.email);
  assert.ok(c && c.interviews === 1, 'history in the media contacts');
});

test('press kit: approved items appear on the public page and their files become public', async () => {
  const doc = await up('document');
  assert.equal((await fetch(`${BASE}${doc.url}`)).status, 404, 'private before approval');
  const id = await make('presskit', { section: 'facts', title: `Fact sheet ${T}`, text: 'Founded 1981. Home: McCarthy Stadium, Makurdi.', files: [{ url: doc.url, label: 'Fact sheet (PDF)', kind: 'document' }] });
  assert.equal((await mc(`items/${id}`, 'POST', { action: 'submit' })).status, 200);
  assert.equal((await admin('approvals', { id, decision: 'approve' })).status, 200);
  const kit = await fetch(`${BASE}/api/media/press-kit`).then(x => x.json());
  const facts = kit.sections.find(s => s.key === 'facts');
  assert.ok(facts && facts.items.some(i => i.title === `Fact sheet ${T}`));
  assert.equal((await fetch(`${BASE}${doc.url}`)).status, 200, 'public after approval');
  assert.equal((await admin('approvals', { id, decision: 'unpublish' })).status, 200);
  assert.equal((await fetch(`${BASE}${doc.url}`)).status, 404, 'private again');
});

test('content calendar: match days, newsletter Wednesdays, assigned plans (on the assignee\'s dashboard)', async () => {
  const due = new Date(Date.now() + 2 * 86400e3).toISOString();
  assert.equal((await mc('calendar', 'POST', { title: 'x' })).status, 400);
  const r = await mc('calendar', 'POST', { title: `Preview piece ${T}`, type: 'news', assigneeId: userId, dueAt: due, status: 'drafting', notes: 'Talk to the coach' });
  assert.equal(r.status, 200);
  const cal = (await mc('calendar')).data;
  assert.ok(cal.planned.some(p => p.title === `Preview piece ${T}` && p.assigneeId === userId));
  assert.ok(cal.matches.some(m => m.id === EV), 'match day');
  assert.ok(cal.wednesdays.length >= 4, 'newsletter Wednesdays');
  const dash = (await mc('dashboard')).data;
  assert.ok(dash.deadlines.some(x => x.title === `Preview piece ${T}`), 'on my dashboard');
  assert.equal((await mc('calendar', 'POST', { action: 'delete', id: r.data.id })).status, 200);
});
