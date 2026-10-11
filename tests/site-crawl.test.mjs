// Final QA: crawls the public site from the homepage and the sitemap and
// checks every internal link works, there are no placeholder "#" links,
// nothing says "Sample", aesonsports.com is only linked from the Partners
// pages, and the site never mentions an academy or a women's team.
// Needs the local Pages dev server.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const SKIP = /^\/(admin|api|scan|cdn-cgi)(\/|$)|\.(ics|pdf|jpg|jpeg|png|webp|svg|ico|json|xml|js|css|txt|xlsx)$/i;
const visible = h => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');

let crawl;
async function site() {
  if (crawl) return crawl;
  const sitemap = await fetch(`${BASE}/sitemap.xml`).then(r => r.text());
  const start = [...sitemap.matchAll(/<loc>https:\/\/lobistarsfc\.com([^<]+)<\/loc>/g)].map(m => m[1]).filter(p => !p.startsWith('/matches/'));
  const matches = [...sitemap.matchAll(/<loc>https:\/\/lobistarsfc\.com(\/matches\/[^<]+)<\/loc>/g)].map(m => m[1]).slice(0, 3);
  const queue = ['/', ...start, ...matches];
  const seen = new Map(); // path -> { status, html, from }
  const from = new Map();
  while (queue.length && seen.size < 400) {
    const p = queue.shift();
    if (seen.has(p)) continue;
    const r = await fetch(BASE + p, { redirect: 'follow' });
    const html = /html/.test(r.headers.get('content-type') || '') ? await r.text() : (await r.body?.cancel(), '');
    seen.set(p, { status: r.status, html });
    for (const m of html.matchAll(/<a\b[^>]*\shref="([^"]*)"/gi)) {
      const href = m[1];
      if (!href.startsWith('/') || href.startsWith('//')) continue;
      const path = href.split('#')[0].split('?')[0] || '/';
      if (SKIP.test(path)) continue;
      if (!from.has(path)) from.set(path, p);
      if (!seen.has(path)) queue.push(path);
    }
  }
  crawl = { seen, from };
  return crawl;
}

test('every internal link on the public site opens (no 404s)', async () => {
  const { seen, from } = await site();
  assert.ok(seen.size > 50, `crawled ${seen.size} pages`);
  const broken = [...seen].filter(([, v]) => v.status >= 400).map(([p, v]) => `${p} (${v.status}, linked from ${from.get(p) || 'sitemap'})`);
  assert.deepEqual(broken, []);
});

test('no placeholder links ("#", empty or javascript:)', async () => {
  const { seen } = await site();
  const bad = [];
  for (const [p, { html }] of seen) {
    for (const m of html.matchAll(/<a\b[^>]*\shref="(#?|javascript:[^"]*)"/gi)) bad.push(`${p}: href="${m[1]}"`);
  }
  assert.deepEqual(bad, []);
});

test('nothing public says "Sample"; no academy or women\'s team; aesonsports.com only on the Partners pages', async () => {
  const { seen } = await site();
  const problems = [];
  for (const [p, { html }] of seen) {
    const text = visible(html);
    if (/\bsample\b/i.test(text)) problems.push(`${p}: "${text.match(/.{0,40}\bsample\b.{0,40}/i)[0]}"`);
    if (/\bacademy\b|women'?s team|ladies team|female team/i.test(text)) problems.push(`${p}: mentions an academy / women's team`);
    if (!p.startsWith('/partners') && /href="https?:\/\/(www\.)?aesonsports\.com/i.test(html)) problems.push(`${p}: links to aesonsports.com`);
  }
  assert.deepEqual(problems, []);
});
