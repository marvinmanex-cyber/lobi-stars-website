// SEO Scanner, without a server: reading a page, robots.txt rules, the issues
// worked out from a scan, the score, the AI guard rails, the corrected
// robots.txt, the redirect target, the VS Code instruction and the guides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analysePage, parseRobots, allowedBy, parseSitemap, similarity, isPrivate, slashed } from '../functions/api/_lib/seoCrawl.js';
import { computeIssues, opportunities } from '../functions/api/_lib/seoAnalyse.js';
import { ISSUES, healthScore, actionsFor, autoAllowed, NEVER_AUTO } from '../functions/api/_lib/seoChecks.js';
import { checkMeta, fixRobots, bestMatch } from '../functions/api/_lib/seoFix.js';
import { guideFor, vscodeInstruction } from '../functions/api/_lib/seoGuides.js';

const ORIGIN = 'https://lobistarsfc.com';
const page = (head, body) => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const GOOD_HEAD = '<title>Lobi Stars v Kano Pillars: match report | Lobi Stars FC</title><meta name="description" content="Goals, photos and the coach\'s reaction from Sunday\'s win over Kano Pillars at McCarthy Stadium in Makurdi."><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://lobistarsfc.com/news/win/"><meta property="og:title" content="x"><meta property="og:description" content="x"><meta property="og:image" content="x"><meta name="twitter:card" content="summary"><meta property="article:published_time" content="2026-10-20T10:00:00Z"><script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","headline":"Win","datePublished":"2026-10-20"}</script><script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}</script>';

test('a page is read into the facts the checks need', () => {
  const d = analysePage(page(GOOD_HEAD, '<header><a href="/shop">Shop</a></header><main><h1>Lobi Stars beat Kano Pillars</h1><p>Lobi Stars won 2–0 at McCarthy Stadium.</p><h3>Skipped level</h3><img src="/images/a.jpg"><img src="/images/b.jpg" alt="Fans" width="10" height="10"><a href="/squad/john-doe/">John</a><a href="https://example.com/x">x</a><a href="/admin/">admin</a><img src="http://cdn.example.com/x.jpg" alt=""></main>'), { origin: ORIGIN, path: '/news/win/' });
  assert.equal(d.title, 'Lobi Stars v Kano Pillars: match report | Lobi Stars FC');
  assert.equal(d.h1.length, 1);
  assert.equal(d.headingSkip, true);
  assert.equal(d.canonical, '/news/win/');
  assert.ok(d.schema.includes('NewsArticle') && d.schema.includes('BreadcrumbList'));
  assert.deepEqual(d.schemaErrors, []);
  assert.equal(d.images.find(i => i.src === '/images/a.jpg').alt, null);
  assert.ok(d.links.includes('/shop/'), 'links are compared with the slash');
  assert.ok(d.links.includes('/squad/john-doe/') && !d.links.includes('/admin/'), 'private areas are never followed');
  assert.deepEqual(d.external, ['https://example.com/x']);
  assert.equal(d.insecure.length, 1);
  assert.ok(d.textSample.includes('McCarthy'));
  assert.equal(slashed('/x.pdf'), '/x.pdf');
  assert.ok(isPrivate('/admin/seo/') && isPrivate('/staff/squad-data/') && !isPrivate('/kitchen/'), '/kitchen/ is the public food page');
});

test('robots.txt: our group or "*", longest rule wins, Google blocked entirely is spotted', () => {
  const r = parseRobots('User-agent: *\nDisallow: /admin\nDisallow: /api/\nAllow: /api/public\n\nSitemap: https://lobistarsfc.com/sitemap.xml');
  assert.equal(allowedBy(r, '/news/'), true);
  assert.equal(allowedBy(r, '/admin/seo/'), false);
  assert.equal(allowedBy(r, '/api/public/x'), true);
  assert.equal(r.blocksAll, false);
  assert.deepEqual(r.sitemaps, ['https://lobistarsfc.com/sitemap.xml']);
  assert.equal(parseRobots('User-agent: *\nDisallow: /').blocksAll, true);
  assert.equal(parseRobots('User-agent: Googlebot\nDisallow: /\nUser-agent: *\nDisallow:').blocksAll, true);
  assert.deepEqual(parseSitemap('<urlset><url><loc>https://lobistarsfc.com/news/a/</loc><lastmod>2026-10-01</lastmod></url></urlset>'), [{ path: '/news/a/', lastmod: '2026-10-01' }]);
});

function basePage(path, over = {}) {
  return { path, status: 200, in_sitemap: 1, data: { title: `A good title for ${path} | Lobi Stars FC`, titleLen: 40, desc: `A description of ${path} that is long enough to be useful to fans on Google, really.`, h1: ['Heading'], headingSkip: false, noindex: false, canonical: path, viewport: true,
    og: { title: true, desc: true, image: true }, twitter: true, hreflang: [], schema: ['BreadcrumbList', 'SportsTeam'], sameAs: true, schemaErrors: [], images: [], links: ['/'], external: [], insecure: [], wordCount: 400, firstPara: '', fp: [], ...over } };
}
test('issues: titles, broken links, private pages, robots, stale fixtures, rankings, no academy', () => {
  const pages = [
    basePage('/', { links: ['/news/', '/shop/', '/missing/'] }),
    basePage('/news/', { title: 'News', desc: '' }),
    basePage('/shop/', { title: 'A good title for /news/ | Lobi Stars FC', images: [{ src: '/images/x.jpg', alt: null, sized: true, webp: true }] }),
    basePage('/tickets/', { noindex: true }),
    { path: '/missing/', status: 404, in_sitemap: 0, data: { linkOnly: true } },
  ];
  pages[1].data.title = 'A good title for /news/ | Lobi Stars FC';
  const out = computeIssues({
    pages, ran: { crawl: true, gsc: true, index: true, speed: false }, linkFrom: { '/missing/': ['/'] }, priv: { '/admin/': { hidden: true }, '/fans/': { hidden: false } },
    robots: parseRobots('User-agent: *\nDisallow: /admin'), robotsOk: true, sitemap: pages.filter(p => p.in_sitemap).map(p => ({ path: p.path })),
    keywords: [{ keyword: 'Lobi Stars tickets', target_path: '/tickets/', priority: 'high', confirmed: 1 }, { keyword: 'Lobi Stars news', target_path: '/news/', priority: 'high', confirmed: 1 }],
    ranks: { 'Lobi Stars news': [...Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-0${i + 1}`, position: 3, page: '/news/' })), ...Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-1${i}`, position: 8, page: '/news/' }))] },
    pageGsc: { '/shop/': { impr28: 900, clicks28: 5, ctr28: 5 / 900, pos28: 4, prev28: 40 } }, totals: { impr7: 50, prevImpr7: 500 },
    inspections: { '/': { verdict: 'PASS' }, '/news/': { verdict: 'NEUTRAL', coverage: 'Crawled - currently not indexed' } }, sitemapGsc: [{ path: 'https://lobistarsfc.com/sitemap.xml', errors: 2 }],
    stale: { events: ['Lobi Stars v Kano (2026-10-01)'], league: [] },
  });
  const types = out.map(i => i.type);
  for (const t of ['title_duplicate', 'desc_missing', 'broken_link', 'img_alt', 'noindex_public', 'private_indexable', 'robots_problem', 'stale_fixtures', 'rank_drop', 'low_ctr', 'clicks_drop', 'deindexed', 'not_indexed', 'sitemap_errors', 'gbp_checklist']) assert.ok(types.includes(t), `${t} found`);
  assert.ok(!types.includes('http_error'), 'a page only linked to is a broken link, not a page error');
  assert.equal(out.find(i => i.type === 'broken_link').detail.data.from[0], '/');
  assert.equal(out.find(i => i.type === 'private_indexable').path, '/fans/');
  for (const i of out) { assert.ok(ISSUES[i.type], `${i.type} is described`); assert.ok(i.id && i.category && i.severity && i.detail.problem); }
  assert.ok(!JSON.stringify(out).match(/academy|women/i));
  // Speed not checked this time: no speed issues are invented.
  assert.ok(!types.some(t => t.startsWith('speed')));
  const top = opportunities(out.map(i => ({ ...i, status: 'open' })));
  assert.ok(top.length <= 5 && new Set(top.map(i => i.type)).size === top.length);
});

test('the score: 100 when clean, critical problems cost most, repeats are capped', () => {
  assert.equal(healthScore([]), 100);
  const crit = healthScore([{ type: 'robots_blocking', severity: 'critical' }]);
  const low = healthScore([{ type: 'title_length', severity: 'low' }]);
  assert.ok(crit < low);
  const many = healthScore(Array.from({ length: 500 }, () => ({ type: 'title_length', severity: 'low' })));
  assert.ok(many >= 98, 'one low issue on 500 pages does not sink the score');
});

test('actions: every type has a guide; automatic only for safe types', () => {
  for (const t of Object.keys(ISSUES)) {
    const g = guideFor(t);
    assert.ok(g.steps.length && g.help, `${t} guide`);
    const a = actionsFor(t);
    assert.equal(a.self, true);
    if (a.autoAllowed) assert.ok(!NEVER_AUTO.includes(t));
  }
  for (const t of ['img_alt', 'desc_missing', 'schema_missing', 'sitemap_errors', 'broken_link']) assert.equal(autoAllowed(t), true, t);
  for (const t of ['title_missing', 'low_ctr', 'robots_blocking', 'thin_page', 'h1_missing']) assert.equal(autoAllowed(t), false, t);
});

test('AI guard rails, robots.txt correction, redirect target and the VS Code instruction', () => {
  assert.deepEqual(checkMeta({ title: 'Lobi Stars tickets | Lobi Stars FC', description: 'Buy tickets for every Lobi Stars home match at McCarthy Stadium online in a minute.' }, 'Lobi Stars tickets').problems, []);
  assert.ok(checkMeta({ title: 'Lobi Stars tickets Lobi Stars tickets', description: 'Lobi Stars tickets, Lobi Stars tickets and Lobi Stars tickets for all fans.' }, 'Lobi Stars tickets').problems.some(p => /stuffing/.test(p)));
  assert.ok(checkMeta({ title: 'Lobi Stars academy trials 2026', description: 'Join the Lobi Stars academy: trials for young players in Makurdi this month.' }).problems.length);
  assert.ok(checkMeta({ title: 'Rated 5 stars by fans | Lobi Stars FC', description: 'The best club in Nigeria, rated 5 stars by thousands of fans across Benue.' }).problems.length);
  const fixed = fixRobots('User-agent: *\nDisallow: /\n');
  assert.ok(!/Disallow:\s*\/\s*$/m.test(fixed));
  assert.ok(/Disallow: \/admin/.test(fixed) && /Sitemap: https:\/\/lobistarsfc\.com\/sitemap\.xml/.test(fixed));
  assert.equal(bestMatch('/news/lobi-stars-beat-kano/', ['/', '/news/', '/news/lobi-stars-beat-kano-pillars/', '/shop/']), '/news/lobi-stars-beat-kano-pillars/');
  assert.equal(bestMatch('/news/zzz/', ['/', '/news/', '/shop/']), '/news/');
  const v = vscodeInstruction({ type: 'h1_missing', path: '/matchday/', problem: '/matchday/ has no main heading (H1).', severity: 'medium' });
  assert.ok(v.includes('https://lobistarsfc.com/matchday/') && v.includes('<h1>') && v.includes('npm run build'));
  assert.ok(similarity([1, 2, 3, 4], [1, 2, 3, 4]) === 1 && similarity([1, 2], [3, 4]) === 0);
});
