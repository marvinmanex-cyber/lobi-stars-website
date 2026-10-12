// Sharing pages: the public Share button's anonymous click counter, the
// admin "Share any page" tool (page search, link-card check, captions, posting
// with a rate limit, marking a manual post, stats) and where the button shows.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123,
// SOCIAL_POST_FAKE=1 and the Telegram channel test secrets (Facebook unset).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const get = (path, headers = ADMIN) => fetch(BASE + path, { headers }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const post = (path, body, headers = ADMIN) => fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body) }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const event = (body, origin = BASE) => fetch(`${BASE}/api/share/event`, { method: 'POST', headers: origin ? { Origin: origin } : {}, body: typeof body === 'string' ? body : JSON.stringify(body) }).then(r => r.status);

test('share clicks: counted anonymously, only valid pages and platforms', async () => {
  assert.equal(await event({ path: '/club/history/', platform: 'whatsapp' }), 204);
  assert.equal(await event({ path: '/club/history/', platform: 'whatsapp' }, null), 400, 'needs our Origin');
  assert.equal(await event({ path: '/club/history/', platform: 'whatsapp' }, 'https://evil.example'), 400);
  for (const path of ['/admin/share/', '/api/x', 'club', '/club/?utm_source=x', '/club/#top', '/a/../b', `/${'x'.repeat(201)}`, '/<script>']) {
    assert.equal(await event({ path, platform: 'copy' }), 400, path);
  }
  assert.equal(await event({ path: '/club/', platform: 'myspace' }), 400);
  assert.equal(await event('not json'), 400);
  const stats = (await get('/api/admin/share/page-stats?range=7')).data;
  assert.ok(stats.topPages.some(p => p.path === '/club/history/'));
  assert.ok(stats.byPlatform.some(p => p.platform === 'whatsapp'));
});

test('page search and link-card check', async () => {
  const pages = (await get('/api/admin/share/pages?q=club history')).data.pages;
  assert.ok(pages.includes('/club/history/'), JSON.stringify(pages));
  const c = (await get(`/api/admin/share/preview?url=${encodeURIComponent(`${BASE}/club/history/`)}`)).data;
  assert.equal(c.status, 200);
  assert.match(c.title, /Club History/);
  assert.match(c.image, /^https:\/\/.+\.jpg$/);
  assert.match(c.captions.twitter, /utm_source=twitter&utm_medium=social&utm_campaign=club_post/);
  assert.match(c.captions.instagram, /Link in bio/);
  assert.ok(!c.captions.instagram.includes('https://'));
  assert.match(c.captions.telegram, /#LobiStarsFC/);
  // Only our own site; never admin or API pages.
  for (const url of ['https://example.com/', 'http://lobistarsfc.com/', 'file:///etc/passwd', `${BASE}/admin/`, `${BASE}/api/health`, 'https://lobistarsfc.com.evil.example/']) {
    assert.equal((await get(`/api/admin/share/preview?url=${encodeURIComponent(url)}`)).status, 400, url);
  }
  assert.equal((await get('/api/admin/share/preview?url=/club/', {})).status, 401);
  // A noindex page is flagged.
  const login = (await get(`/api/admin/share/preview?url=${encodeURIComponent(`${BASE}/fans/login/`)}`)).data;
  assert.ok(login.warnings.some(w => /noindex/.test(w.text)));
});

test('posting: Telegram automatically, Facebook not set up, 3 per hour, manual marks, history', async () => {
  // A path of its own each run, so the hourly limit starts from zero.
  const path = `/news/share-test-${Date.now()}/`;
  const url = `${BASE}${path}?run=1`;
  const r = await post('/api/admin/share/page-post', { url, title: 'Honours', platforms: ['telegram', 'facebook', 'twitter'], captions: { telegram: `Honours\n\n${url}` } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const by = Object.fromEntries(r.data.results.map(x => [x.key, x]));
  assert.equal(by.telegram.ok, true);
  assert.match(by.telegram.externalUrl, /^https:\/\/t\.me\//);
  assert.equal(by.facebook.notConfigured, true);
  assert.equal(by.twitter.ok, false);
  // The same page counts across query strings: the path is what's limited.
  await post('/api/admin/share/page-post', { url, platforms: ['telegram'], caption: 'Again' });
  await post('/api/admin/share/page-post', { url, platforms: ['telegram'], caption: 'Again' });
  const fourth = await post('/api/admin/share/page-post', { url, platforms: ['telegram'], caption: 'Again' });
  assert.equal(fourth.status, 429);
  assert.equal((await post('/api/admin/share/page-post', { url: 'https://example.com/', platforms: ['telegram'], caption: 'x' })).status, 400);
  assert.equal((await post('/api/admin/share/page-mark', { url, platformKey: 'instagram', title: 'Honours' })).status, 200);
  assert.equal((await post('/api/admin/share/page-mark', { url, platformKey: 'myspace' })).status, 400);
  const posts = (await get('/api/admin/share/page-stats?range=30')).data.posts;
  assert.ok(posts.some(p => p.path === path && p.platform_key === 'instagram' && p.status === 'marked'));
  assert.ok(posts.some(p => p.path === path && p.platform_key === 'telegram' && p.status === 'posted' && p.mode === 'auto'));
});

test('the Share button shows on content pages, not on sign-in, checkout, 404 or staff pages', async () => {
  const has = async p => /data-share[\s>]/.test(await (await fetch(BASE + p)).text());
  for (const p of ['/club/history/', '/partners/aeson-sports-management/', '/tickets/', '/membership/', '/hospitality/', '/food/', '/help/', '/news/', '/squad/']) assert.ok(await has(p), `missing on ${p}`);
  for (const p of ['/', '/fans/login/', '/fans/account/', '/tickets/success/', '/food/order/', '/no-such-page/', '/admin/share/', '/programme/']) assert.ok(!(await has(p)), `should not be on ${p}`);
  // Match pages: the share bar is switched on by the server for the match's own address.
  const ev = await post('/api/admin/events', { home_team: 'Lobi Stars FC', away_team: 'Share Test FC', competition: 'NNL', venue: 'McCarthy Stadium, Makurdi', event_date: new Date(Date.now() + 5 * 864e5).toISOString(), vip_price_kobo: 0, premium_price_kobo: 0, regular_price_kobo: 0, active: true });
  assert.equal(ev.status, 200);
  const slug = (await get('/api/matches')).data.matches?.find(m => m.away_team === 'Share Test FC')?.slug;
  if (slug) {
    const html = await (await fetch(`${BASE}/matches/${slug}/`)).text();
    assert.match(html, /<div class="wrap mc-sharebar" data-match-share(?! hidden)[^>]*>/);
    assert.match(html, /<link rel="canonical" href="[^"]*\/matches\/[^"]*share-test-fc\/"/);
  }
  assert.match(await (await fetch(`${BASE}/match-centre/`)).text(), /data-match-share hidden/);
});
