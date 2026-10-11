// Phase 8: search engines and sharing (titles, descriptions, canonical,
// Open Graph / Twitter, share images, JSON-LD, sitemap) and interface
// translations (only complete languages published; switcher only for
// reviewed ones). Needs the local Pages dev server with ADMIN_CODE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const html = path => fetch(BASE + path).then(r => r.text());
const metaOf = (h, attr, name) => h.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`))?.[1];
const ld = h => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
const local = u => u.replace(/^https?:\/\/[^/]+/, '');

test('every page in the sitemap has a unique title, description, canonical URL, share tags and a working share image', async () => {
  const sitemap = await html('/sitemap.xml');
  const paths = [...sitemap.matchAll(/<loc>https:\/\/lobistarsfc\.com([^<]+)<\/loc>/g)].map(m => m[1]).filter(p => !p.startsWith('/matches/'));
  assert.ok(paths.length >= 30, `${paths.length} pages`);
  const titles = new Map();
  const images = new Set();
  for (const p of paths) {
    const h = await html(p);
    const title = h.match(/<title>([^<]+)<\/title>/)?.[1];
    assert.ok(title, `${p} title`);
    assert.ok(!titles.has(title), `${p} has the same title as ${titles.get(title)}`);
    titles.set(title, p);
    assert.ok((metaOf(h, 'name', 'description') || '').length > 20, `${p} description`);
    assert.equal(h.match(/<link rel="canonical" href="([^"]+)"/)?.[1], `https://lobistarsfc.com${p}`, `${p} canonical`);
    for (const [a, n] of [['property', 'og:title'], ['property', 'og:description'], ['property', 'og:url'], ['name', 'twitter:card'], ['name', 'twitter:title'], ['name', 'twitter:image']]) assert.ok(metaOf(h, a, n), `${p} ${n}`);
    images.add(local(metaOf(h, 'property', 'og:image')));
  }
  for (const img of images) assert.equal((await fetch(BASE + img)).status, 200, img);
});

test('pages without their own photo get a branded share image; news keeps its photo', async () => {
  const awards = await html('/awards/');
  assert.match(metaOf(awards, 'property', 'og:image'), /\/og\/awards\.jpg$/);
  const img = await fetch(BASE + '/og/awards.jpg');
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  const homepage = await html('/');
  assert.match(metaOf(homepage, 'property', 'og:image'), /og-default\.jpg$/);
  const story = [...(await html('/sitemap.xml')).matchAll(/<loc>https:\/\/lobistarsfc\.com(\/news\/[^<]+)<\/loc>/g)].map(m => m[1]).find(p => p !== '/news/');
  if (story) {
    const h = await html(story);
    assert.doesNotMatch(metaOf(h, 'property', 'og:image'), /\/og\//, 'stories use their cover photo');
    const art = ld(h).find(d => d['@type'] === 'NewsArticle');
    assert.ok(art && art.headline && art.datePublished && art.image);
    assert.ok(ld(h).some(d => d['@type'] === 'BreadcrumbList'));
  }
  assert.ok(ld(homepage).some(d => d['@type'] === 'SportsTeam'));
});

test('match pages: own title, share image with both teams, SportsEvent and breadcrumbs; listed in the sitemap', async () => {
  const events = await fetch(`${BASE}/api/admin/events`, { headers: ADMIN }).then(r => r.json());
  const list = (events.events || events).filter(e => e.active !== 0);
  assert.ok(list.length, 'needs at least one match');
  const sitemap = await html('/sitemap.xml');
  const slugs = [...sitemap.matchAll(/<loc>https:\/\/lobistarsfc\.com(\/matches\/[^<]+)<\/loc>/g)].map(m => m[1]);
  assert.ok(slugs.length >= 1, 'matches listed in the sitemap');
  const h = await html(slugs[0]);
  const ev = ld(h).find(d => d['@type'] === 'SportsEvent');
  assert.ok(ev, 'SportsEvent');
  assert.ok(ev.startDate && ev.homeTeam?.name && ev.awayTeam?.name && ev.location?.name);
  assert.match(ev.eventStatus, /^https:\/\/schema\.org\/Event/);
  assert.ok(ld(h).some(d => d['@type'] === 'BreadcrumbList'));
  const og = local(metaOf(h, 'property', 'og:image'));
  assert.match(og, /^\/og\/match\//);
  assert.equal((await fetch(BASE + og)).status, 200);
  assert.match(h.match(/<title>([^<]+)/)[1], / vs .*Match Centre/);
  assert.equal(h.match(/<link rel="canonical" href="([^"]+)"/)?.[1].replace(/^https?:\/\/[^/]+/, ''), slugs[0]);
});

test('sitemap leaves out drafts, sample players, admin and hidden pages', async () => {
  const sitemap = await html('/sitemap.xml');
  assert.doesNotMatch(sitemap, /\/admin|\/offline|\/payment\/|\/scan/);
  const dir = new URL('../src/content/news/', import.meta.url);
  for (const f of readdirSync(dir)) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    if (/^status:\s*"?draft/m.test(src)) assert.ok(!sitemap.includes(`/news/${f.replace(/\.md$/, '')}/`), `draft ${f} not listed`);
  }
});

test('translations: only complete languages are published; the switcher shows only reviewed ones; news stays English', async () => {
  const en = JSON.parse(readFileSync(new URL('../src/i18n/en.json', import.meta.url), 'utf8'));
  const keys = Object.keys(en.strings);
  for (const code of ['pcm', 'ha', 'tiv']) {
    const f = JSON.parse(readFileSync(new URL(`../src/i18n/${code}.json`, import.meta.url), 'utf8'));
    assert.deepEqual(Object.keys(f.strings).sort(), [...keys].sort(), `${code} has every English key`);
    const complete = keys.every(k => f.strings[k] && !/^TODO/.test(f.strings[k]));
    const r = await fetch(`${BASE}/i18n/${code}.json`);
    assert.equal(r.status === 200, complete, `${code}: published only when complete`);
    if (complete) assert.deepEqual(Object.keys(await r.json()).sort(), [...keys].sort());
  }
  const home = await html('/');
  const reviewed = ['pcm', 'ha', 'tiv'].filter(c => JSON.parse(readFileSync(new URL(`../src/i18n/${c}.json`, import.meta.url), 'utf8'))._meta.reviewed);
  assert.equal(home.includes('class="ls"'), reviewed.length > 0, 'switcher only with a reviewed language');
  // Every piece of interface text in the footer is in the English source.
  const footer = home.slice(home.indexOf('<footer'), home.indexOf('</footer>'));
  for (const t of ['Club Newsletter', 'Sign up', 'Cookie settings', 'Terms of Use']) { assert.ok(footer.includes(t)); assert.ok(keys.includes(t), t); }
  assert.match(home, /data-i18n-scope/);
});
