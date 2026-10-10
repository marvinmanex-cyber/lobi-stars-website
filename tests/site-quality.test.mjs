// Site quality checks: pages arrive with real content (no "Loading…"), and
// draft/sample content never reaches the public site. Needs the local Pages
// dev server (see tests/fans.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const html = path => fetch(`${BASE}${path}`).then(async r => ({ status: r.status, body: await r.text() }));
// Visible text only (scripts and styles removed), so code in <script> doesn't count.
const visible = body => body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');

test('pages are rendered on the server: no "Loading…" placeholders', async () => {
  for (const path of ['/', '/fixtures/', '/results/', '/watch/', '/commentary/', '/tickets/', '/programme/', '/man-of-the-match/']) {
    const { status, body } = await html(path);
    assert.equal(status, 200, path);
    assert.doesNotMatch(visible(body), /Loading(&hellip;|…|\.\.\.)/i, path);
  }
});

test('homepage Next Matches and the fixtures list arrive with fixture cards and data', async () => {
  const home = (await html('/')).body;
  assert.match(home, /id="ssr-matches"/);
  assert.ok(/class="nm-card"/.test(home) || /announced soon/.test(home), 'cards or the "announced soon" message');
  const fx = (await html('/fixtures/')).body;
  assert.ok(/class="fx"/.test(fx) || /announced soon/.test(fx));
  const { matches } = await fetch(`${BASE}/api/matches`).then(r => r.json());
  const next = matches.find(m => /lobi stars/i.test(m.home_team + m.away_team) && m.status === 'scheduled' && new Date(m.event_date) > Date.now());
  if (next) assert.ok(home.includes(next.away_team.replace(/&/g, '&amp;')) || home.includes(next.home_team), 'next fixture is in the HTML');
});

test('match pages embed their match so they render straight away', async () => {
  const { matches } = await fetch(`${BASE}/api/matches`).then(r => r.json());
  const m = matches[0];
  if (!m) return;
  const mc = (await html(`/matches/${m.slug}/`)).body;
  assert.match(mc, /id="ssr-match"/);
  assert.doesNotMatch(visible(mc), /Loading match/);
});

test('embedded data cannot break out of its <script> tag', async () => {
  const { jsonScript } = await import('../functions/api/_lib/ssr.js');
  const out = jsonScript('x', { a: '</script><img src=x onerror=alert(1)>' });
  assert.equal((out.match(/<\/script>/g) || []).length, 1);
});

test('draft (sample) news and sample players are not public', async () => {
  const news = (await html('/news/')).body;
  assert.doesNotMatch(visible(news), />\s*Sample\s*</);
  assert.equal((await html('/news/2026-10-08-first-team-step-up-preparations-for-kada-warriors/')).status, 404);
  assert.equal((await html('/squad/sample-goalkeeper/')).status, 404);
  const sitemap = (await html('/sitemap.xml')).body;
  assert.doesNotMatch(sitemap, /sample|\/news\/2026-/);
  const search = await fetch(`${BASE}/search-index.json`).then(r => r.json());
  assert.ok(!search.some(i => /sample/i.test(i.url)), 'search has no sample items');
  const home = visible((await html('/')).body);
  assert.doesNotMatch(home, />\s*Sample\s*</);
});

test('Cookie settings in the footer is a real button', async () => {
  const body = (await html('/')).body;
  assert.match(body, /<button type="button" data-cookie-settings[^>]*>Cookie settings<\/button>/);
});

test('news index for Match Centre and the matchday checklist lists published stories only', async () => {
  const res = await fetch(`${BASE}/data/news-index.json`);
  assert.equal(res.status, 200);
  const items = await res.json();
  assert.ok(Array.isArray(items));
  assert.ok(!items.some(i => /first-team-step-up-preparations/.test(i.slug)), 'draft samples are not listed');
  for (const i of items) assert.ok('contentType' in i && 'matchDate' in i && Array.isArray(i.teamNews));
});
