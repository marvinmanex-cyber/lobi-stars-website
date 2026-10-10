// Phase 2 site features: newsletter upgrade, full-time banner, calendars,
// sitemap page, header/account and the mobile tab bar. Needs the local Pages
// dev server with FANS_DEV_LINKS=1 and ADMIN_CODE=test-code-123.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 9);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const r7 = () => String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const post = (path, body, headers = {}) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp(), ...headers }, body: JSON.stringify(body) })
  .then(async r => ({ status: r.status, data: await r.json().catch(() => ({})), headers: r.headers }));

test('newsletter: validation, +234 phone, duplicates update the record and reach the fan database', async () => {
  const email = `nl-${uid()}@example.com`;
  const base = { fullName: 'Ada Lovelace', phone: `0803${r7()}`, email, confirmEmail: email, consent: true };
  assert.equal((await post('/api/newsletter', { ...base, confirmEmail: `x${email}` })).data.errors.confirmEmail, 'The email addresses do not match.');
  assert.ok((await post('/api/newsletter', { ...base, phone: '12345' })).data.errors.phone);
  assert.ok((await post('/api/newsletter', { ...base, consent: false })).data.errors.consent);
  assert.ok((await post('/api/newsletter', { ...base, fullName: '' })).data.errors.fullName);

  const first = await post('/api/newsletter', base);
  assert.equal(first.status, 200);
  assert.equal(first.data.updated, false);
  const again = await post('/api/newsletter', { ...base, fullName: 'Ada King' });
  assert.equal(again.status, 200);
  assert.equal(again.data.updated, true);
  assert.equal(again.data.message, "You're already subscribed – details updated.");

  const fans = await fetch(`${BASE}/api/admin/fans?q=${encodeURIComponent(email)}`, { headers: ADMIN }).then(r => r.json());
  assert.equal(fans.total, 1);
  assert.equal(fans.rows[0].phone, `+234${base.phone.slice(1)}`);
  assert.equal(fans.rows[0].firstName, 'Ada');
  assert.equal(fans.rows[0].surname, 'King', 'latest details win');
  await fetch(`${BASE}/api/admin/fans/${fans.rows[0].id}`, { method: 'DELETE', headers: ADMIN });
});

test('FULL TIME banner shows on the homepage after a Lobi Stars match, with links only for content that exists', async () => {
  const opp = `FT Test ${uid()}`;
  const ev = await fetch(`${BASE}/api/admin/events`, { method: 'POST', headers: ADMIN, body: JSON.stringify({
    home_team: 'Lobi Stars FC', away_team: opp, competition: 'NNL Conference D', venue: 'McCarthy Stadium, Makurdi',
    event_date: new Date(Date.now() - 2 * 3600e3).toISOString(), vip_price_kobo: 0, premium_price_kobo: 0, regular_price_kobo: 0, active: true,
  }) }).then(r => r.json());
  const ctl = body => fetch(`${BASE}/api/admin/match-centre/${ev.id}`, { method: 'POST', headers: ADMIN, body: JSON.stringify(body) });
  await ctl({ action: 'kickoff' });
  await ctl({ action: 'fulltime', home_score: 3, away_score: 1 });
  let home = await fetch(`${BASE}/`).then(r => r.text());
  assert.match(home, new RegExp(`<strong>Full time:</strong> Lobi Stars 3–1 ${opp}`));
  assert.doesNotMatch(home.split('id="ftBanner"')[1].split('</div>')[0], />Report</, 'no report yet, so no Report link');

  // Add a report: the Report link appears.
  const { match } = await fetch(`${BASE}/api/admin/match-centre/${ev.id}`, { headers: ADMIN }).then(r => r.json());
  await fetch(`${BASE}/api/admin/match-centre/${ev.id}`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ status: 'full-time', home_score: 3, away_score: 1, report: 'A fine win.', squad: match.squad }) });
  home = await fetch(`${BASE}/`).then(r => r.text());
  assert.match(home.split('id="ftBanner"')[1].split('</div>')[0], />Report</);
});

test('calendars: /fixtures.ics feed and single-match downloads', async () => {
  const feed = await fetch(`${BASE}/fixtures.ics`);
  assert.equal(feed.status, 200);
  assert.match(feed.headers.get('content-type'), /text\/calendar/);
  assert.match(await feed.text(), /BEGIN:VCALENDAR[\s\S]*X-WR-CALNAME:Lobi Stars FC Fixtures/);
  const { matches } = await fetch(`${BASE}/api/matches`).then(r => r.json());
  const one = await fetch(`${BASE}/api/calendar?match=${matches[0].slug}`);
  assert.equal(one.status, 200);
  assert.match(one.headers.get('content-disposition'), /attachment/);
  assert.equal(((await one.text()).match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.equal((await fetch(`${BASE}/api/calendar?match=no-such-match`)).status, 404);
  const home = await fetch(`${BASE}/`).then(r => r.text());
  assert.match(home, /href="\/api\/calendar\?match=/, 'homepage fixture cards have Add to calendar');
});

test('human-readable /sitemap page is linked in the footer', async () => {
  const res = await fetch(`${BASE}/sitemap/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  for (const href of ['/fixtures', '/news', '/squad', '/membership', '/privacy']) assert.ok(html.includes(`href="${href}"`), href);
  assert.match(await fetch(`${BASE}/`).then(r => r.text()), /<a href="\/sitemap"[^>]*>Sitemap<\/a>/);
});

test('header icons, mobile tab bar and the account page', async () => {
  const html = await fetch(`${BASE}/news/`).then(r => r.text());
  assert.match(html, /aria-label="Search the site"/);
  assert.match(html, /aria-label="Club shop"/);
  assert.match(html, /id="accountLink" href="\/fans\/login\/"/);
  assert.match(html, /<nav class="tb" aria-label="Quick links">/);
  assert.match(html, /class="tb-item" href="\/news" aria-current="page"/, 'News tab active on the news page');
  assert.equal((await fetch(`${BASE}/fans/account/`)).status, 200);

  // Login sets the non-secret hint cookie; logout clears it.
  const email = `acc-${uid()}@example.com`;
  const reg = await post('/api/fans/register', { firstName: 'Acc', surname: 'Ount', email, confirmEmail: email, phone: `0813${r7()}`, password: 'Lobi-Stars-2026', confirmPassword: 'Lobi-Stars-2026', agree: true });
  await fetch(reg.data.devLink.replace('https://lobistarsfc.com', BASE), { redirect: 'manual' });
  const login = await post('/api/auth/login', { email, password: 'Lobi-Stars-2026' });
  const cookies = login.headers.getSetCookie();
  assert.ok(cookies.some(c => c.startsWith('ls_session=') && /HttpOnly/i.test(c)));
  assert.ok(cookies.some(c => c.startsWith('ls_fan=1') && !/HttpOnly/i.test(c)));
  const out = await post('/api/auth/logout', {});
  assert.ok(out.headers.getSetCookie().some(c => c.startsWith('ls_fan=;') && /Max-Age=0/.test(c)));
});
