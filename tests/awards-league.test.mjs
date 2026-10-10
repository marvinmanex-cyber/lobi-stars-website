// Fan Awards and Season Prediction League tests. Needs the local Pages dev
// server with FANS_DEV_LINKS=1 and ADMIN_CODE=test-code-123 (see tests/fans.test.mjs).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 10);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const r7 = () => String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const H = 3600e3;
const created = [];

async function post(path, body, cookie) {
  const res = await fetch(BASE + path, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp(), ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})), headers: res.headers };
}
const get = (path, cookie) => fetch(BASE + path, { headers: cookie ? { Cookie: cookie } : {} }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const admin = (path, method = 'GET', body) => fetch(BASE + path, { method, headers: ADMIN, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));

async function fan(first = 'Terna', last = 'Akaa') {
  const email = `aw-${uid()}@example.com`;
  const reg = await post('/api/fans/register', {
    firstName: first, surname: last, email, confirmEmail: email, phone: `0803${r7()}`,
    password: 'Lobi-Stars-2026', confirmPassword: 'Lobi-Stars-2026', agree: true, marketing: false,
  });
  assert.ok(reg.data.devLink, 'start the dev server with --binding FANS_DEV_LINKS=1');
  await fetch(reg.data.devLink.replace('https://lobistarsfc.com', BASE), { redirect: 'manual' });
  const login = await post('/api/auth/login', { email, password: 'Lobi-Stars-2026' });
  assert.equal(login.status, 200);
  return { cookie: login.headers.get('set-cookie').split(';')[0] };
}

let roster;
async function players() {
  roster ??= await fetch(`${BASE}/data/players.json`).then(r => r.json());
  assert.ok(roster.length >= 3, 'needs at least 3 players in /data/players.json');
  return roster;
}

async function award(over = {}) {
  const ps = await players();
  const body = {
    type: 'potm', period: `Test ${uid()}`,
    opens_at: new Date(Date.now() - H).toISOString(), closes_at: new Date(Date.now() + 24 * H).toISOString(),
    nominees: [{ player: ps[0].slug }, { player: ps[1].slug }, { player: ps[2].slug }], ...over,
  };
  const r = await admin('/api/admin/awards', 'POST', body);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  created.push(r.data.id);
  return { id: r.data.id, body };
}
const publicAward = async (id, cookie) => {
  const d = (await get('/api/awards', cookie)).data;
  return { award: d.awards.find(a => a.id === id), d };
};

after(async () => { for (const id of created) await admin(`/api/admin/awards/${id}`, 'DELETE'); });

// ─── Awards ───

test('admin: awards need staff access and valid nominees', async () => {
  assert.equal((await fetch(`${BASE}/api/admin/awards`)).status, 401);
  const ps = await players();
  const base = { type: 'gotm', period: 'October 2026', opens_at: new Date().toISOString(), closes_at: new Date(Date.now() + H).toISOString() };
  const two = await admin('/api/admin/awards', 'POST', { ...base, nominees: [{ label: 'A', youtube: 'dQw4w9WgXcQ' }, { label: 'B', youtube: 'https://youtu.be/dQw4w9WgXcQ' }] });
  assert.equal(two.status, 400);
  assert.match(two.data.error, /3 to 5/);
  const bad = await admin('/api/admin/awards', 'POST', { ...base, nominees: [{ label: 'A', youtube: 'not a clip' }, { label: 'B', youtube: 'dQw4w9WgXcQ' }, { label: 'C', youtube: 'dQw4w9WgXcQ' }] });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /YouTube/);
  const backwards = await admin('/api/admin/awards', 'POST', { type: 'potm', period: 'x', opens_at: base.closes_at, closes_at: base.opens_at, nominees: [{ player: ps[0].slug }, { player: ps[1].slug }] });
  assert.equal(backwards.status, 400);

  // YouTube links of every common shape are accepted and stored as the video id.
  const { id } = await award({ type: 'gotm', nominees: [
    { player: ps[0].slug, label: 'vs Test FC', youtube: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    { label: 'Free kick', youtube: 'https://youtube.com/shorts/dQw4w9WgXcQ' },
    { label: 'Volley', youtube: 'dQw4w9WgXcQ' },
  ] });
  const { award: a } = await publicAward(id);
  assert.deepEqual(a.nominees.map(n => n.youtube), ['dQw4w9WgXcQ', 'dQw4w9WgXcQ', 'dQw4w9WgXcQ']);
  assert.equal(a.nominees[0].player.slug, ps[0].slug);
  assert.equal(a.title, 'Goal of the Month');
});

test('voting: login required, one vote per fan, results hidden until closed', async () => {
  const { id } = await award();
  const { award: a } = await publicAward(id);
  assert.equal(a.state, 'open');
  const nom = a.nominees[0].id;

  // Logged out: refused. (Fans can only log in after confirming their email;
  // the vote endpoint checks it again.)
  const out = await post(`/api/awards/${id}/vote`, { nominee: nom });
  assert.equal(out.status, 401);
  assert.equal(out.data.code, 'login');

  const f = await fan();
  assert.equal((await post(`/api/awards/${id}/vote`, { nominee: 999999 }, f.cookie)).status, 400);
  const ok = await post(`/api/awards/${id}/vote`, { nominee: nom }, f.cookie);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.totalVoters, 1);
  const again = await post(`/api/awards/${id}/vote`, { nominee: a.nominees[1].id }, f.cookie);
  assert.equal(again.status, 409);
  assert.equal(again.data.code, 'voted');

  const mine = await publicAward(id, f.cookie);
  assert.equal(mine.d.myVotes[id].nominee, nom);
  assert.equal(mine.award.results, null, 'no counts while voting is open');
  assert.equal(mine.award.totalVoters, 1);
});

test('upcoming and closed awards refuse votes; closing reveals joint winners', async () => {
  const soon = await award({ opens_at: new Date(Date.now() + H).toISOString(), closes_at: new Date(Date.now() + 2 * H).toISOString() });
  const f = await fan();
  const { award: s } = await publicAward(soon.id);
  assert.equal(s.state, 'upcoming');
  const early = await post(`/api/awards/${soon.id}/vote`, { nominee: s.nominees[0].id }, f.cookie);
  assert.equal(early.status, 409);
  assert.equal(early.data.code, 'before');

  const { id, body } = await award();
  const { award: a } = await publicAward(id);
  const [n1, n2] = a.nominees;
  assert.equal((await post(`/api/awards/${id}/vote`, { nominee: n1.id }, (await fan()).cookie)).status, 200);
  assert.equal((await post(`/api/awards/${id}/vote`, { nominee: n2.id }, (await fan()).cookie)).status, 200);

  // Changing the shortlist after votes is refused; dates still change.
  const ps = await players();
  const edit = await admin(`/api/admin/awards/${id}`, 'PUT', { ...body, nominees: [{ player: ps[2].slug }, { player: ps[1].slug }], opens_at: new Date(Date.now() - 2 * H).toISOString(), closes_at: new Date(Date.now() - 1000).toISOString() });
  assert.equal(edit.status, 200, JSON.stringify(edit.data));
  assert.equal(edit.data.nomineesLocked, true);

  const late = await post(`/api/awards/${id}/vote`, { nominee: n1.id }, f.cookie);
  assert.equal(late.status, 409);
  assert.equal(late.data.code, 'closed');
  const { award: c } = await publicAward(id);
  assert.equal(c.state, 'closed');
  assert.deepEqual(c.nominees.map(n => n.id), a.nominees.map(n => n.id), 'nominees unchanged');
  assert.equal(c.results.total, 2);
  assert.deepEqual([...c.results.winners].sort(), [n1.id, n2.id].sort(), 'joint winners on a tie');
});

test('/awards page: rendered on the server, sponsor name and logo only when a partner is set', async () => {
  const partners = await fetch(`${BASE}/data/partners.json`).then(r => r.json());
  const withLogo = partners.find(p => p.logo);
  const plain = await award();
  const sponsored = await award(withLogo ? { sponsor: withLogo.slug } : {});
  const html = await fetch(`${BASE}/awards/`).then(r => r.text());
  assert.match(html, new RegExp(`data-award="${plain.id}"`));
  assert.match(html, /Player of the Month/);
  assert.match(html, /<h1[^>]*>Fan <span/);
  assert.match(html, /Skip to content/i);
  if (withLogo) {
    assert.match(html, new RegExp(`${withLogo.name} Player of the Month`));
    assert.match(html, new RegExp(`<img src="${withLogo.logo}" alt="${withLogo.name}"`));
  }
  const plainCard = html.slice(html.indexOf(`data-award="${plain.id}"`)).split('</article>')[0];
  assert.doesNotMatch(plainCard, /aw-sponsor/);
});

test('erasing a fan unlinks their award votes but keeps the count', async () => {
  // Covered structurally: contacts.js unlinks award_votes like motm_votes and predictions.
  const src = await import('node:fs').then(fs => fs.readFileSync(new URL('../functions/api/_lib/contacts.js', import.meta.url), 'utf8'));
  assert.match(src, /UPDATE award_votes SET member_id = 'deleted-' \|\| id WHERE member_id = \?/);
});

// ─── Season Prediction League ───

async function match(kickoffInMs) {
  const res = await fetch(`${BASE}/api/admin/events`, {
    method: 'POST', headers: ADMIN, body: JSON.stringify({
      home_team: 'Lobi Stars FC', away_team: `League Test ${uid()}`, competition: 'NNL Conference D',
      venue: 'McCarthy Stadium, Makurdi', event_date: new Date(Date.now() + kickoffInMs).toISOString(),
      vip_price_kobo: 0, premium_price_kobo: 0, regular_price_kobo: 0, active: true,
    }),
  });
  const { id } = await res.json();
  return (await fetch(`${BASE}/api/admin/match-centre/${id}`, { headers: ADMIN }).then(r => r.json())).match;
}
const control = (id, body) => fetch(`${BASE}/api/admin/match-centre/${id}`, { method: 'POST', headers: ADMIN, body: JSON.stringify(body) }).then(r => r.json());

test('league: 3 points for an exact score, 1 for the result, ties by exact scores then earliest entry; staff excluded', async () => {
  const m = await match(2 * H);
  const early = await fan('Aondo', 'Exact');
  const late = await fan('Bem', 'Exact');
  const result = await fan('Chia', 'Result');
  const wrong = await fan('Doo', 'Wrong');
  const staff = await fan('Staff', 'Member');
  for (const [f, h, a] of [[early, 2, 1], [late, 2, 1], [result, 1, 0], [wrong, 0, 2], [staff, 2, 1]]) {
    const r = await post(`/api/matches/${m.slug}/predict`, { home: h, away: a }, f.cookie);
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  const entries = (await admin(`/api/admin/predictions/${m.id}`)).data.entries;
  const staffEntry = entries.find(e => /^Staff/.test(e.name));
  await admin(`/api/admin/predictions/${m.id}`, 'POST', { action: 'staff', memberId: staffEntry.memberId, isStaff: true });
  await control(m.id, { action: 'kickoff' });
  const ft = await control(m.id, { action: 'fulltime', home_score: 2, away_score: 1 });
  assert.equal(ft.predictionWinner, true, JSON.stringify(ft));

  const me = async f => (await get('/api/fans/league', f.cookie)).data;
  const [e, l, r, w, s] = await Promise.all([early, late, result, wrong, staff].map(me));
  assert.deepEqual([e.me.points, e.me.exact, e.me.predictions], [3, 1, 1]);
  assert.deepEqual([l.me.points, l.me.exact], [3, 1]);
  assert.deepEqual([r.me.points, r.me.exact], [1, 0]);
  assert.equal(w.me.points, 0);
  assert.ok(e.me.rank < l.me.rank, 'same points and exact scores: the earlier entry ranks higher');
  assert.ok(l.me.rank < r.me.rank && r.me.rank < w.me.rank);
  assert.equal(s.me, null);
  assert.equal(s.staff, true);
  assert.equal((await get('/api/fans/league')).status, 401);

  // Public table: first name + surname initial only; staff not listed.
  const html = await fetch(`${BASE}/predict-and-win/league/`).then(x => x.text());
  assert.match(html, /<td>Aondo E\.<\/td>/);
  assert.doesNotMatch(html, /Aondo Exact/);
  assert.doesNotMatch(html, /<td>Staff M\.<\/td>/);
  assert.match(html, /<th scope="col">Points<\/th>/);
});

test('league: the Predict & Win terms describe the season league and the fan account links to it', async () => {
  const terms = await fetch(`${BASE}/predict-and-win/terms/`).then(r => r.text());
  assert.match(terms, /Season Prediction League/);
  assert.match(terms, /3 points for the exact score/);
  const account = await fetch(`${BASE}/fans/account/`).then(r => r.text());
  assert.match(account, /id="lgMine"/);
  assert.match(account, /href="\/predict-and-win\/league\/"/);
});
