// Share Hub: tracked share links /m/<slug> with link cards (og: tags, safe
// escaping, drafts hidden, robots not counted), the public card image,
// "upcoming" programmes, share images, captions, mark-as-posted, auto-post
// (Telegram in fake mode, Facebook not set up), scheduled posts via the cron
// endpoint (posts once), platform settings, roles. Needs the local Pages dev
// server with --r2=PROGRAMME_BUCKET, ADMIN_CODE=test-code-123,
// CRON_SECRET=cron-test-secret, TELEGRAM_PUBLIC_BOT_TOKEN, TELEGRAM_PUBLIC_CHANNEL
// and SOCIAL_POST_FAKE=1 (tests only).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { renderCaption, captionLength, intentUrl, programmeState, escapeHtml, shareUrl, PLATFORM_SEED } from '../functions/api/_lib/share.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const CRON = process.env.CRON_SECRET || 'cron-test-secret';
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const ANDROID = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const api = (path, method = 'GET', body, headers = ADMIN) => fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' })
  .then(async r => ({ status: r.status, headers: r.headers, data: await r.clone().json().catch(() => ({})), text: () => r.text() }));
const made = [];
after(async () => { for (const id of made) await fetch(`${BASE}/api/admin/programmes/${id}`, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ status: 'hidden' }) }); });

const JPG = (n = 120) => new Blob([new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, ...new Array(n).fill(7)])], { type: 'image/jpeg' });
async function programme(title = `Lobi Stars vs Share ${uid()}`, status = 'published', extra = {}) {
  const r = await api('/api/admin/programmes', 'POST', { title, competition: 'NNL', venue: 'McCarthy Stadium', kickoffAt: new Date(Date.now() + 2 * 864e5).toISOString() });
  made.push(r.data.id);
  const f = new FormData();
  f.append('pdf', new Blob([new TextEncoder().encode('%PDF-1.7\n% share\n')]), 'p.pdf'); f.append('cover', JPG(), 'c.jpg'); f.append('pageCount', '4');
  for (let i = 1; i <= 4; i++) f.append(`page${i}`, JPG(), `p${i}.jpg`);
  assert.equal((await fetch(`${BASE}/api/admin/programmes/${r.data.id}/upload`, { method: 'POST', headers: { 'x-admin-code': ADMIN['x-admin-code'] }, body: f })).status, 200);
  if (status !== 'draft') assert.equal((await api(`/api/admin/programmes/${r.data.id}`, 'PATCH', { status, ...extra })).status, 200);
  return r.data;
}
const assets = (id, over = {}) => {
  const f = new FormData();
  f.append('card', over.card || JPG(2000), 'card.jpg'); f.append('square', over.square || JPG(), 's.jpg'); f.append('story', over.story || JPG(), 'st.jpg');
  return fetch(`${BASE}/api/admin/programmes/${id}/share-assets`, { method: 'POST', headers: { 'x-admin-code': ADMIN['x-admin-code'] }, body: f }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
};

test('helpers: captions, X counts links as 23, intent links, states, escaping', () => {
  const p = { slug: 'lobi-stars-vs-enyimba-2026-10-18', title: 'Lobi Stars vs Enyimba', venue: 'McCarthy Stadium', kickoff_at: '2026-10-18T15:00:00Z', publish_at: '2026-10-17T15:00:00Z', version: 2 };
  const fb = { key: 'facebook', campaign_code: 'facebook', hashtags: '#LobiStarsFC' };
  const live = PLATFORM_SEED.find(x => x[0] === 'facebook')[3];
  const c = renderCaption(live, p, fb, 'live');
  assert.match(c, /Lobi Stars vs Enyimba is OUT!/);
  assert.match(c, /Sunday 18 October · ⏰ 4:00 PM · 📍 McCarthy Stadium/);
  assert.ok(c.includes('https://lobistarsfc.com/m/lobi-stars-vs-enyimba-2026-10-18?src=facebook&v=2'));
  assert.ok(!/\n{3}/.test(c));
  const ig = renderCaption(PLATFORM_SEED.find(x => x[0] === 'instagram')[3], p, { key: 'instagram', campaign_code: 'instagram', hashtags: '' }, 'live');
  assert.match(ig, /Link in bio/); assert.ok(!ig.includes('https://'), 'no link in Instagram captions');
  const up = renderCaption(PLATFORM_SEED.find(x => x[0] === 'telegram')[4], p, { key: 'telegram', campaign_code: 'telegram', hashtags: '' }, 'upcoming');
  assert.match(up, /drops Saturday 17 October at 4:00 PM/);
  const x = `${'a'.repeat(250)} https://lobistarsfc.com/m/${'x'.repeat(100)}`;
  assert.deepEqual(captionLength('twitter', x), { length: 250 + 1 + 23, limit: 280, over: false });
  assert.equal(captionLength('telegram', 'é'.repeat(1025)).over, true);
  const url = shareUrl(p.slug, 'twitter', 2);
  const xi = new URL(intentUrl('twitter', `Hello ${url} #Lobi`, url));
  assert.equal(xi.searchParams.get('url'), url);
  assert.ok(!xi.searchParams.get('text').includes('https://'), 'link not repeated in the text');
  assert.equal(new URL(intentUrl('facebook', 'x', url)).searchParams.get('u'), url);
  assert.ok(new URL(intentUrl('whatsapp', `Hi ${url}`, url)).searchParams.get('text').endsWith(url));
  assert.equal(intentUrl('instagram', 'x', url), null);
  assert.equal(programmeState({ status: 'published', pdf_key: 'k' }), 'live');
  assert.equal(programmeState({ status: 'scheduled', pdf_key: 'k', publish_at: new Date(Date.now() + 1e6).toISOString() }), 'upcoming');
  assert.equal(programmeState({ status: 'hidden', pdf_key: 'k' }), 'unavailable');
  assert.equal(escapeHtml(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.equal(shareUrl('s', 'Bad Src', 3), 'https://lobistarsfc.com/m/s?v=3');
});

test('/m/<slug>: link card for robots and people, escaped, drafts hidden, robots not counted', async () => {
  // Tags are already stripped from titles when saved; quotes and & must still be escaped here.
  const p = await programme(`Lobi Stars vs "Kwara" & Co <script>x</script> ${uid()}`);
  const url = `/m/${p.slug}?src=facebook&v=1`;
  const page = await api(url, 'GET', null, { 'User-Agent': 'facebookexternalhit/1.1' });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(page.headers.get('cache-control'), /public, max-age=60/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  for (const tag of ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:url', 'og:image', 'og:image:alt', 'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) assert.match(html, new RegExp(`(property|name)="${tag}"`), tag);
  assert.ok(!html.includes('<script>x'), 'no tags');
  assert.match(html, /og:title" content="Match Day Programme: Lobi Stars vs &quot;Kwara&quot; &amp; Co /, 'quotes and & escaped');
  assert.match(html, new RegExp(`content="https://lobistarsfc.com/m/${p.slug}/card\\.jpg\\?v=\\d+"`));
  assert.match(html, new RegExp(`location\\.replace\\("/programme/scan/\\?c=facebook&slug=${p.slug}"\\)`));
  assert.match(html, /Free for Lobi Stars fans/);
  // Draft and unknown: straight to the scan page, nothing revealed.
  const d = await programme(`Draft ${uid()}`, 'draft');
  for (const path of [`/m/${d.slug}?src=facebook`, '/m/does-not-exist', '/m/BAD!slug']) {
    const r = await api(path, 'GET', null, {});
    assert.equal(r.status, 302, path); assert.equal(r.headers.get('location'), `${BASE}/programme/scan/`);
  }
  // Counting: people yes, link previews no.
  const before = (await api(`/api/admin/programmes/${p.id}/share`)).data.platforms.find(x => x.key === 'facebook').stats.visits;
  await api(url, 'GET', null, { 'User-Agent': ANDROID });
  await api(url, 'GET', null, { 'User-Agent': 'WhatsApp/2.23' });
  await new Promise(r => setTimeout(r, 800));
  const after2 = (await api(`/api/admin/programmes/${p.id}/share`)).data.platforms.find(x => x.key === 'facebook').stats.visits;
  assert.equal(after2 - before, 1);
});

test('card image, share images upload rules, upcoming programmes', async () => {
  const p = await programme();
  const cover = await fetch(`${BASE}/m/${p.slug}/card.jpg`);
  assert.equal(cover.status, 200, 'cover until share images exist');
  assert.equal((await assets(p.id, { card: new Blob(['not a jpeg']) })).status, 400);
  assert.equal((await assets(p.id, { card: JPG(410 * 1024) })).status, 413, 'card over 400 KB');
  const ok = await assets(p.id);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const card = await fetch(`${BASE}/m/${p.slug}/card.jpg?v=1`);
  assert.equal(card.status, 200);
  assert.equal(card.headers.get('content-type'), 'image/jpeg');
  assert.match(card.headers.get('cache-control'), /public, max-age=86400/);
  assert.equal((await card.arrayBuffer()).byteLength, 2004);
  assert.equal((await fetch(`${BASE}/api/programme/${p.slug}/share/card.jpg`)).status, 200, 'api alias');
  assert.equal((await fetch(`${BASE}/api/admin/programmes/${p.id}/share-assets/story.jpg`, { headers: ADMIN })).status, 200);
  const html = await (await fetch(`${BASE}/m/${p.slug}?src=twitter`)).text();
  assert.match(html, /og:image:width" content="1200"/);
  // Scheduled for later: shareable, with a countdown; the API says 'upcoming'.
  const u = await programme(`Lobi Stars vs Soon ${uid()}`, 'scheduled', { publishAt: new Date(Date.now() + 3 * 3600e3).toISOString() });
  const d = (await api(`/api/programme/${u.slug}`, 'GET', null, {})).data;
  assert.equal(d.state, 'upcoming'); assert.ok(d.publishAt && d.serverTime);
  assert.ok(!('version' in d) && !('coverUrl' in d), 'no file details before it drops');
  assert.match(await (await fetch(`${BASE}/m/${u.slug}?src=whatsapp`)).text(), /Drops .* Register now/);
  assert.equal((await api(`/api/programme/${p.slug}`, 'GET', null, {})).data.state, 'live');
});

test('Share Hub data, captions, mark as posted, auto-post (Telegram fake, Facebook not set up), rate limit', async () => {
  const p = await programme();
  await assets(p.id);
  const hub = (await api(`/api/admin/programmes/${p.id}/share`)).data;
  assert.deepEqual(hub.platforms.map(x => x.key), ['telegram', 'facebook', 'twitter', 'whatsapp', 'instagram', 'tiktok', 'youtube']);
  const tg = hub.platforms.find(x => x.key === 'telegram'), fb = hub.platforms.find(x => x.key === 'facebook'), ig = hub.platforms.find(x => x.key === 'instagram');
  assert.equal(tg.effectiveMode, 'auto'); assert.equal(fb.effectiveMode, 'intent'); assert.equal(ig.effectiveMode, 'manual');
  assert.equal(fb.configured, false);
  assert.match(fb.intentUrl, /^https:\/\/www\.facebook\.com\/sharer\/sharer\.php\?u=/);
  assert.equal(ig.bioUrl, 'https://lobistarsfc.com/p/instagram');
  assert.ok(tg.shareUrl.includes(`?src=telegram&v=`));
  assert.equal(hub.assetsReady, true); assert.equal(hub.assetsStale, false);
  assert.ok(!JSON.stringify(hub).includes('public-test'), 'no secrets');
  // Captions
  assert.equal((await api(`/api/admin/programmes/${p.id}/share/captions`, 'PUT', { platformKey: 'twitter', caption: 'Short and sweet\u0007 #LobiStars' })).status, 200);
  assert.equal((await api(`/api/admin/programmes/${p.id}/share`)).data.platforms.find(x => x.key === 'twitter').caption, 'Short and sweet #LobiStars');
  assert.equal((await api(`/api/admin/programmes/${p.id}/share/captions`, 'PUT', { platformKey: 'nope', caption: 'x' })).status, 400);
  // Mark as posted
  assert.equal((await api(`/api/admin/programmes/${p.id}/share/mark`, 'POST', { platformKey: 'instagram' })).status, 200);
  // Auto-post
  assert.equal((await api(`/api/admin/programmes/${p.id}/share/post`, 'POST', { platforms: ['facebook'] })).status, 400, 'Facebook not set up');
  assert.equal((await api(`/api/admin/programmes/${p.id}/share/post`, 'POST', { platforms: ['instagram'] })).status, 400);
  const post = await api(`/api/admin/programmes/${p.id}/share/post`, 'POST', { platforms: ['telegram'] });
  assert.equal(post.status, 200, JSON.stringify(post.data));
  assert.equal(post.data.results[0].ok, true);
  assert.match(post.data.results[0].externalUrl, /^https:\/\/t\.me\//);
  await api(`/api/admin/programmes/${p.id}/share/post`, 'POST', { platforms: ['telegram'] });
  await api(`/api/admin/programmes/${p.id}/share/post`, 'POST', { platforms: ['telegram'] });
  assert.equal((await api(`/api/admin/programmes/${p.id}/share/post`, 'POST', { platforms: ['telegram'] })).status, 429, '3 an hour');
  const after2 = (await api(`/api/admin/programmes/${p.id}/share`)).data;
  assert.equal(after2.platforms.find(x => x.key === 'telegram').lastPost.status, 'posted');
  assert.equal(after2.platforms.find(x => x.key === 'instagram').lastPost.status, 'marked');
  assert.ok(after2.history.length >= 4);
});

test('scheduled auto-post: cron secret, posts once, failures recorded', async () => {
  const p = await programme();
  assert.equal((await api(`/api/admin/programmes/${p.id}/share/schedule`, 'PUT', { at: new Date(Date.now() - 60e3).toISOString(), platforms: ['instagram'] })).status, 400, 'auto platforms only');
  assert.equal((await api(`/api/admin/programmes/${p.id}/share/schedule`, 'PUT', { at: new Date(Date.now() - 60e3).toISOString(), platforms: ['telegram', 'facebook'] })).status, 200);
  assert.equal((await fetch(`${BASE}/api/internal/social-autopost`, { method: 'POST' })).status, 403);
  const run = () => fetch(`${BASE}/api/internal/social-autopost`, { method: 'POST', headers: { Authorization: `Bearer ${CRON}` } }).then(r => r.json());
  const [a, b] = await Promise.all([run(), run()]);
  const mine = [...a.posted, ...b.posted].filter(x => x.programme === p.slug);
  assert.equal(mine.length, 1, 'claimed once');
  const res = Object.fromEntries(mine[0].results.map(r => [r.platform, r]));
  assert.equal(res.telegram.ok, true);
  assert.equal(res.facebook.ok, false, 'Facebook not set up: recorded as failed');
  const hub = (await api(`/api/admin/programmes/${p.id}/share`)).data;
  assert.equal(hub.schedule.done, true);
  assert.ok(hub.history.some(h => h.platform_key === 'facebook' && h.status === 'failed' && h.staff_email === null));
  assert.equal((await run()).posted.filter(x => x.programme === p.slug).length, 0, 'never twice');
  assert.equal((await api(`/api/admin/programmes/${p.id}/share/schedule`, 'PUT', { at: null })).status, 200);
});

test('platform settings: https profile links, key never changes; roles', async () => {
  const list = (await api('/api/admin/share/platforms')).data.platforms;
  assert.equal(list.length, 7);
  assert.equal((await api('/api/admin/share/platforms', 'PATCH', { key: 'facebook', profile_url: 'http://facebook.com/x' })).status, 400);
  assert.equal((await api('/api/admin/share/platforms', 'PATCH', { key: 'facebook', campaign_code: 'fb' })).status, 400);
  const ok = await api('/api/admin/share/platforms', 'PATCH', { key: 'facebook', profile_url: 'https://www.facebook.com/lobistarsfc', hashtags: '#LobiStarsFC   #MatchDay' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.platform.hashtags, '#LobiStarsFC #MatchDay');
  assert.equal((await api('/api/admin/share/platforms', 'PATCH', { key: 'facebook', hashtags: '#LobiStarsFC #LobiStars #MatchDay #NNL', profile_url: '' })).status, 200);
  const login = async role => {
    const email = `sh-${role}-${uid()}@example.com`;
    await api('/api/admin/staff', 'POST', { name: `SH ${role}`, email, password: 'Role-Test-2026!', role });
    const l = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
    return { Cookie: l.headers.get('set-cookie').split(';')[0] };
  };
  assert.equal((await api('/api/admin/share/platforms', 'GET', null, await login('media'))).status, 200);
  assert.equal((await api('/api/admin/share/platforms', 'GET', null, await login('commercial'))).status, 403);
});

test('fan share uses the tracked link; reader, programme page and scan page include it', async () => {
  for (const path of ['/programme/read/', '/programme/', '/programme/scan/']) {
    const html = await (await fetch(BASE + path)).text();
    assert.match(html, /lobistarsfc\.com\/m\/' \+ encodeURIComponent\(p\.slug\) \+ '\?src=fanshare&v=/, path);
    assert.match(html, /Get the Lobi Stars match day programme free:/, path);
  }
  assert.match(await (await fetch(`${BASE}/privacy/`)).text(), /Shared links:/);
});
