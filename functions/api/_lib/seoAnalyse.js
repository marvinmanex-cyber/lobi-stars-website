// SEO Scanner: from the facts gathered by a scan to the list of issues.
// Pure functions (no database, no network), so they are tested directly.
// Each issue: { id, type, category, severity, path, impact, detail: { urls, problem, data } }.
import { info } from './seoChecks.js';
import { similarity } from './seoCrawl.js';

const KEY_PAGES = ['/', '/news/', '/fixtures/', '/table/', '/squad/', '/tickets/', '/shop/'];
const isNews = p => /^\/news\/[^/]+\/$/.test(p);
const isPlayer = p => /^\/squad\/(?!staff\/)[^/]+\/$/.test(p);
const isStaffProfile = p => /^\/squad\/staff\/[^/]+\/$/.test(p);
// Utility pages that are meant to be short (no "thin content" warning).
const SHORT_OK = /^\/(search|tickets|shop|food|scan|offline|unsubscribe|payment|fans|membership|season-tickets|predict-and-win|motm|man-of-the-match|matchday-live|watch|video|commentary|programme|scores|data|newsletter|rewards|gallery|fixtures|results|table|stats|sitemap|404)(\/|$)/;
const list = (a, n = 5) => a.length <= n ? a.join(', ') : `${a.slice(0, n).join(', ')} and ${a.length - n} more`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function make(type, path, problem, extra = {}) {
  const i = info(type);
  const key = extra.key ? `:${extra.key}` : '';
  return { id: `${type}:${path || 'site'}${key}`.slice(0, 300), type, category: i.category, severity: extra.severity || i.severity, path: path || null,
    impact: extra.impact ?? i.impact, detail: { urls: extra.urls || (path ? [path] : []), problem, data: extra.data || null } };
}

/**
 * input: {
 *   pages: [{ path, status, in_sitemap, lastmod, data }],   // data = analysePage() + { hops, loop, error, ms, linkOnly, from }
 *   priv: { path: { status, noindex, hidden } }, linkStatus: { path: status }, linkFrom: { path: [pages] },
 *   extStatus: { url: status }, extFrom: { url: page }, imgSize: { src: bytes }, robots, robotsOk, sitemap: [{ path }],
 *   keywords, ranks: { keyword: [{ date, position, page, clicks, impressions }] }, pageGsc: { path: { clicks28, prev28, impr28, ctr28, pos28 } },
 *   totals: { clicks7, prev7, impr7, prevImpr7 }, inspections: { path: { verdict, coverage } }, sitemapGsc: [..] | null,
 *   speed: { path: { mobile, desktop } }, stale: { events: [], league: [] }, players: [{ name, path }], ran: { crawl, gsc, index, speed }
 * }
 */
export function computeIssues(input) {
  const out = [];
  const pages = input.pages || [];
  const ok = pages.filter(p => p.status === 200 && p.data && !p.data.error);
  const byPath = new Map(pages.map(p => [p.path, p]));

  if (input.ran?.crawl) {
    // ── Status, redirects ──
    for (const p of pages) {
      const d = p.data || {};
      if (d.loop) out.push(make('redirect_loop', p.path, `${p.path} redirects in a loop (${(d.hops || []).map(h => h.to).join(' → ')}).`, { data: { hops: d.hops } }));
      else if ((d.hops || []).length >= 2) out.push(make('redirect_chain', p.path, `${p.path} goes through ${d.hops.length} redirects before the page opens: ${d.hops.map(h => `${h.from} → ${h.to}`).join(', ')}.`, { data: { hops: d.hops } }));
      if (!p.status || p.status >= 400) {
        if (d.linkOnly) continue; // reported as a broken link below
        out.push(make('http_error', p.path, `${p.path} answers ${p.status ? `with error ${p.status}` : `nothing (${d.error || 'no answer'})`}.`, { severity: p.path === '/' ? 'critical' : undefined, impact: p.path === '/' ? 10 : undefined, data: { status: p.status } }));
      }
    }
    // ── Broken internal links (pages linked from our pages that do not open) ──
    const broken = new Map();
    for (const [path, st] of Object.entries(input.linkStatus || {})) if (st === 0 || st === 404 || st === 410 || st >= 500) broken.set(path, st);
    for (const p of pages) if (p.data?.linkOnly && (!p.status || p.status === 404 || p.status === 410 || p.status >= 500)) broken.set(p.path, p.status);
    for (const [path, st] of broken) {
      const from = (input.linkFrom || {})[path] || [];
      out.push(make('broken_link', path, `${plural(from.length || 1, 'page links', 'pages link')} to ${path}, which ${st ? `answers error ${st}` : 'does not open'}${from.length ? `: ${list(from, 4)}` : ''}.`, { urls: [path, ...from.slice(0, 10)], data: { status: st, from } }));
    }
    for (const [url, st] of Object.entries(input.extStatus || {})) {
      if (st === 404 || st === 410 || st === 0) out.push(make('broken_external', (input.extFrom || {})[url] || null, `A link to ${url} ${st ? `answers error ${st}` : 'does not open'}.`, { key: url.slice(0, 120), urls: [(input.extFrom || {})[url]].filter(Boolean), data: { url, status: st } }));
    }

    // ── Titles and descriptions ──
    const titles = new Map(), descs = new Map();
    for (const p of ok) {
      if (p.data.noindex) continue;
      const t = p.data.title, ds = p.data.desc;
      if (!t) out.push(make('title_missing', p.path, `${p.path} has no page title.`));
      else {
        (titles.get(t) || titles.set(t, []).get(t)).push(p.path);
        if (t.length > 60 || t.length < 30) out.push(make('title_length', p.path, `The title of ${p.path} is ${t.length} characters (aim for 30–60): "${t}".`, { data: { title: t, length: t.length } }));
      }
      if (!ds) out.push(make('desc_missing', p.path, `${p.path} has no meta description.`));
      else {
        (descs.get(ds) || descs.set(ds, []).get(ds)).push(p.path);
        if (ds.length > 160 || ds.length < 70) out.push(make('desc_length', p.path, `The meta description of ${p.path} is ${ds.length} characters (aim for 70–160).`, { data: { description: ds, length: ds.length } }));
      }
    }
    for (const [t, ps] of titles) if (ps.length > 1) for (const p of ps) out.push(make('title_duplicate', p, `${p} has the same title as ${list(ps.filter(x => x !== p), 3)}: "${t}".`, { urls: ps, data: { title: t, pages: ps } }));
    for (const [ds, ps] of descs) if (ps.length > 1) for (const p of ps) out.push(make('desc_duplicate', p, `${p} has the same meta description as ${list(ps.filter(x => x !== p), 3)}.`, { urls: ps, data: { description: ds, pages: ps } }));

    // ── Headings, images, canonical, noindex, mobile, sharing, structured data, mixed content ──
    const largeImages = [], notWebp = new Map();
    for (const p of ok) {
      const d = p.data;
      if (!d.noindex) {
        if (!d.h1.length) out.push(make('h1_missing', p.path, `${p.path} has no main heading (H1).`));
        else if (d.h1.length > 1) out.push(make('h1_multiple', p.path, `${p.path} has ${d.h1.length} main headings (H1): ${list(d.h1.map(h => `"${h}"`), 3)}.`, { data: { h1: d.h1 } }));
        if (d.headingSkip) out.push(make('heading_order', p.path, `The headings on ${p.path} skip a level (for example H2 straight to H4).`));
      }
      const noAlt = d.images.filter(i => i.alt === null);
      if (noAlt.length) out.push(make('img_alt', p.path, `${plural(noAlt.length, 'picture')} on ${p.path} ${noAlt.length === 1 ? 'has' : 'have'} no alt text.`, { data: { images: noAlt.map(i => i.src).slice(0, 20) } }));
      const unsized = d.images.filter(i => !i.sized);
      if (unsized.length >= 2) out.push(make('img_size_attr', p.path, `${plural(unsized.length, 'picture')} on ${p.path} ${unsized.length === 1 ? 'has' : 'have'} no width and height.`, { data: { images: unsized.map(i => i.src).slice(0, 20) } }));
      for (const i of d.images) {
        const b = (input.imgSize || {})[i.src];
        if (b > 300 * 1024 && !largeImages.some(x => x.src === i.src)) largeImages.push({ src: i.src, kb: Math.round(b / 1024), page: p.path });
        if (!i.webp && /\.(jpe?g|png)$/i.test(i.src)) notWebp.set(i.src, p.path);
      }
      if (d.noindex) {
        const meant = p.in_sitemap || KEY_PAGES.includes(p.path) || (input.keywords || []).some(k => k.target_path === p.path);
        if (meant) out.push(make('noindex_public', p.path, `${p.path} tells Google not to index it ("noindex"), but it is a public page${p.in_sitemap ? ' listed in the sitemap' : ''}.`));
      } else {
        if (!d.canonical) out.push(make('canonical_missing', p.path, `${p.path} has no canonical tag.`));
        else if (d.canonical.replace(/\/?$/, '/') !== p.path.replace(/\/?$/, '/')) out.push(make('canonical_wrong', p.path, `The canonical tag of ${p.path} points to ${d.canonical}.`, { data: { canonical: d.canonical } }));
      }
      if (!d.viewport) out.push(make('viewport_missing', p.path, `${p.path} has no mobile viewport tag.`));
      const social = [!d.og.title && 'og:title', !d.og.desc && 'og:description', !d.og.image && 'og:image', !d.twitter && 'twitter:card'].filter(Boolean);
      if (social.length && !d.noindex) out.push(make('social_tags', p.path, `${p.path} is missing ${social.join(', ')}.`, { data: { missing: social } }));
      const badLang = (d.hreflang || []).filter(h => !/^(x-default|[a-z]{2}(-[a-z]{2})?)$/i.test(h));
      if (badLang.length) out.push(make('hreflang_invalid', p.path, `${p.path} has language tags that are not valid: ${badLang.join(', ')}.`));
      if (d.insecure.length) out.push(make('https_problem', p.path, `${p.path} loads ${plural(d.insecure.length, 'file')} over insecure http://: ${list(d.insecure, 3)}.`, { data: { files: d.insecure } }));
      if (d.schemaErrors.length) out.push(make('schema_invalid', p.path, `Structured data on ${p.path}: ${d.schemaErrors.join('; ')}.`, { data: { errors: d.schemaErrors } }));
      if (!d.noindex) {
        const need = [];
        if (p.path === '/' && !d.schema.some(t => ['SportsTeam', 'SportsOrganization', 'Organization'].includes(t))) need.push('SportsTeam / Organization');
        if (isNews(p.path) && !d.schema.includes('NewsArticle')) need.push('NewsArticle');
        if ((isPlayer(p.path) || isStaffProfile(p.path)) && !d.schema.includes('Person')) need.push('Person');
        if (p.path === '/fixtures/' && !d.schema.includes('SportsEvent')) need.push('SportsEvent');
        if (p.path !== '/' && !d.schema.includes('BreadcrumbList')) need.push('BreadcrumbList');
        if (need.length) out.push(make('schema_missing', p.path, `${p.path} has no ${need.join(' or ')} structured data.`, { data: { need } }));
      }
      if (p.path === '/' && d.schema.some(t => ['SportsTeam', 'SportsOrganization', 'Organization'].includes(t)) && !d.sameAs) {
        // sameAs is read by the page check (data.sameAs); missing means no social links in the club's data.
        out.push(make('org_social', '/', 'The club’s structured data on the homepage does not list its social media profiles (sameAs).'));
      }
    }
    for (const im of largeImages) out.push(make('img_large', im.page, `${im.src} is ${im.kb} KB (shown on ${im.page}). Aim for under 200 KB.`, { key: im.src.slice(0, 120), urls: [im.page], data: im }));
    if (notWebp.size >= 3) out.push(make('img_format', null, `${plural(notWebp.size, 'picture')} ${notWebp.size === 1 ? 'is' : 'are'} served only as JPEG/PNG, without a WebP copy: ${list([...notWebp.keys()], 4)}.`, { urls: [...new Set(notWebp.values())].slice(0, 10), data: { images: [...notWebp.keys()].slice(0, 40) } }));

    // ── Private areas must stay hidden ──
    for (const [path, r] of Object.entries(input.priv || {})) {
      if (!r.hidden) out.push(make('private_indexable', path, `${path} opened without signing in and without "noindex", so search engines could list it.`, { data: r }));
    }

    // ── robots.txt and sitemap.xml ──
    const rb = input.robots;
    if (input.robotsOk === false) out.push(make('robots_problem', null, 'robots.txt could not be read.'));
    else if (rb) {
      if (rb.blocksAll) out.push(make('robots_blocking', null, 'robots.txt tells Google not to read any page of the website ("Disallow: /").'));
      const probs = [];
      if (!rb.sitemaps.length) probs.push('it does not point to the sitemap');
      if (!rb.google.disallow.some(d => /^\/admin/.test(d))) probs.push('it does not keep /admin out');
      const blockedKey = KEY_PAGES.filter(k => rb.google.disallow.some(d => d !== '/' && d.length > 1 && k.startsWith(d.replace(/\*.*$/, ''))));
      if (blockedKey.length) probs.push(`it blocks public pages: ${blockedKey.join(', ')}`);
      if (probs.length) out.push(make('robots_problem', null, `robots.txt: ${probs.join('; ')}.`, { data: { problems: probs } }));
    }
    const inSitemap = new Set(input.sitemapAll || (input.sitemap || []).map(s => s.path));
    const missing = (input.sitemapAll === null ? [] : ok).filter(p => !p.data.noindex && !inSitemap.has(p.path) && !p.data.linkOnly404).map(p => p.path).filter(p => !/^\/(search|404)/.test(p));
    if (missing.length) out.push(make('sitemap_missing_page', null, `${plural(missing.length, 'public page')} ${missing.length === 1 ? 'is' : 'are'} missing from sitemap.xml: ${list(missing, 5)}.`, { urls: missing.slice(0, 20), data: { pages: missing } }));
    const badEntries = (input.sitemap || []).map(s => byPath.get(s.path)).filter(p => p && (p.status !== 200 || p.data?.noindex || (p.data?.hops || []).length));
    if (badEntries.length) out.push(make('sitemap_bad_entry', null, `sitemap.xml lists ${plural(badEntries.length, 'page')} that ${badEntries.length === 1 ? 'is' : 'are'} broken, redirect${badEntries.length === 1 ? 's' : ''} or ${badEntries.length === 1 ? 'is' : 'are'} noindex: ${list(badEntries.map(p => p.path), 5)}.`, { urls: badEntries.map(p => p.path).slice(0, 20) }));

    // ── Content ──
    for (const p of ok) {
      const d = p.data;
      if (d.noindex || SHORT_OK.test(p.path) || p.path === '/') continue;
      const min = isNews(p.path) ? 150 : isPlayer(p.path) || isStaffProfile(p.path) ? 40 : 120;
      if (d.wordCount < min) out.push(make('thin_page', p.path, `${p.path} has only about ${d.wordCount} words of text.`, { data: { words: d.wordCount } }));
    }
    // Orphans: in the sitemap, but no other scanned page links to them.
    const inbound = new Map();
    for (const p of ok) for (const l of p.data.links || []) if (l !== p.path) inbound.set(l, (inbound.get(l) || 0) + 1);
    if (input.complete !== false) for (const p of ok) if (p.in_sitemap && p.path !== '/' && !p.data.noindex && !inbound.get(p.path)) out.push(make('orphan_page', p.path, `No other page on the website links to ${p.path}.`));
    // News stories that mention a player or coach by name without linking to their profile.
    const people = (input.players || []).filter(x => x.name && x.name.length > 4);
    for (const p of ok.filter(x => isNews(x.path))) {
      const text = String(p.data.textSample || '').toLowerCase();
      const missingLinks = people.filter(pl => text.includes(pl.name.toLowerCase()) && !(p.data.links || []).includes(pl.path)).slice(0, 6);
      if (missingLinks.length) out.push(make('news_player_links', p.path, `${p.path} mentions ${list(missingLinks.map(x => x.name), 4)} without linking to ${missingLinks.length === 1 ? 'their profile' : 'their profiles'}.`, { data: { people: missingLinks } }));
    }
    // Near-duplicates (pages that share most of their wording).
    const long = ok.filter(p => !p.data.noindex && p.data.wordCount > 120 && p.data.fp?.length >= 8);
    const buckets = new Map();
    for (const p of long) for (const h of p.data.fp.slice(0, 4)) (buckets.get(h) || buckets.set(h, []).get(h)).push(p);
    const seenPair = new Set();
    for (const group of buckets.values()) {
      if (group.length < 2 || group.length > 20) continue;
      for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j], k = [a.path, b.path].sort().join('|');
        if (seenPair.has(k)) continue;
        seenPair.add(k);
        if (similarity(a.data.fp, b.data.fp) >= 0.8) out.push(make('duplicate_content', a.path, `${a.path} and ${b.path} are almost the same text.`, { key: b.path, urls: [a.path, b.path] }));
      }
    }
    // Keyword on its page (title, main heading or first paragraph).
    for (const k of (input.keywords || []).filter(k => k.confirmed && k.target_path)) {
      const p = byPath.get(k.target_path);
      if (!p || p.status !== 200 || !p.data) continue;
      const words = k.keyword.toLowerCase().split(/\s+/).filter(w => w.length > 1);
      const has = s => { const t = String(s || '').toLowerCase(); return words.every(w => t.includes(w)); };
      const where = { title: has(p.data.title), heading: has((p.data.h1 || []).join(' ')), intro: has(p.data.firstPara) || has(p.data.desc) };
      if (!where.title && !where.heading) out.push(make('keyword_missing', p.path, `The target phrase "${k.keyword}" is not in the title or main heading of ${p.path}.`, { key: k.keyword.toLowerCase().slice(0, 60), data: { keyword: k.keyword, ...where } }));
    }
  }

  // ── Stale fixtures and league table ──
  const st = input.stale || {};
  if ((st.events || []).length) out.push(make('stale_fixtures', '/fixtures/', `${plural(st.events.length, 'past match', 'past matches')} still shown as upcoming: ${list(st.events, 4)}.`, { data: { events: st.events } }));
  if ((st.league || []).length) out.push(make('stale_fixtures', '/table/', `${plural(st.league.length, 'league match', 'league matches')} played over 3 days ago still have no result, so the table is out of date: ${list(st.league, 4)}.`, { key: 'league', data: { league: st.league } }));

  // ── Rankings and visibility (Search Console average position; or the licensed tracker) ──
  if (input.ran?.gsc) {
    for (const k of input.keywords || []) {
      const rows = (input.ranks || {})[k.keyword] || [];
      if (!rows.length) continue;
      const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
      const last = sorted.slice(-3).filter(r => r.position), prevRows = sorted.slice(-14, -7).filter(r => r.position);
      if (!last.length) continue;
      const avg = a => a.reduce((s, r) => s + r.position, 0) / a.length;
      const now = avg(last), prev = prevRows.length ? avg(prevRows) : null;
      const page = last[last.length - 1].page;
      if (prev !== null && now - prev >= 3) out.push(make('rank_drop', k.target_path || page, `"${k.keyword}" fell from about position ${prev.toFixed(1)} to ${now.toFixed(1)} on Google.`, { key: k.keyword.toLowerCase().slice(0, 60), severity: k.priority === 'high' ? 'high' : 'medium', data: { keyword: k.keyword, from: prev, to: now, page } }));
      else if (now >= 4 && now <= 15) out.push(make('almost_top', k.target_path || page, `"${k.keyword}" is at about position ${now.toFixed(1)} on Google: a small improvement would move it ${now > 10 ? 'onto page one' : 'into the top three'}.`, { key: k.keyword.toLowerCase().slice(0, 60), impact: k.priority === 'high' ? 9 : 7, data: { keyword: k.keyword, position: now, page } }));
      if (k.target_path && page && page.replace(/\/?$/, '/') !== k.target_path && now <= 30) out.push(make('cannibal', k.target_path, `For "${k.keyword}" Google shows ${page} instead of ${k.target_path}.`, { key: k.keyword.toLowerCase().slice(0, 60), urls: [k.target_path, page], data: { keyword: k.keyword, shown: page, target: k.target_path } }));
    }
    for (const [path, g] of Object.entries(input.pageGsc || {})) {
      if (g.impr28 >= 200 && g.pos28 <= 10 && g.ctr28 < 0.02) out.push(make('low_ctr', path, `${path} was seen ${g.impr28.toLocaleString('en-GB')} times on Google in 28 days but only ${(g.ctr28 * 100).toFixed(1)}% clicked (average position ${g.pos28.toFixed(1)}).`, { data: g }));
      if (g.prev28 >= 20 && g.clicks28 <= g.prev28 * 0.6) out.push(make('clicks_drop', path, `${path} had ${g.clicks28} Google clicks in the last 28 days, down from ${g.prev28} (−${Math.round((1 - g.clicks28 / g.prev28) * 100)}%).`, { data: g }));
    }
    const t = input.totals || {};
    if (t.prevImpr7 >= 100 && t.impr7 <= t.prevImpr7 * 0.6) out.push(make('deindexed', null, `Google showed the website ${t.impr7} times in the last 7 days, down from ${t.prevImpr7} (−${Math.round((1 - t.impr7 / t.prevImpr7) * 100)}%).`, { data: t }));
  }
  if (input.ran?.index) {
    for (const [path, r] of Object.entries(input.inspections || {})) if (r && r.verdict && r.verdict !== 'PASS') out.push(make('not_indexed', path, `Google says ${path}: "${r.coverage || r.verdict}".`, { severity: path === '/' ? 'critical' : undefined, data: r }));
    if (input.sitemapGsc) {
      const sm = input.sitemapGsc;
      if (!sm.length) out.push(make('sitemap_unread', null, 'No sitemap has been submitted to Google Search Console.', { severity: 'high' }));
      for (const m of sm) {
        if (m.errors) out.push(make('sitemap_errors', null, `Google reports ${plural(m.errors, 'error')} in ${m.path}.`, { key: m.path.slice(-60), data: m }));
        else if (!m.lastDownloaded || Date.now() - Date.parse(m.lastDownloaded) > 14 * 864e5) out.push(make('sitemap_unread', null, `Google last read ${m.path} ${m.lastDownloaded ? `on ${m.lastDownloaded.slice(0, 10)}` : 'never'}.`, { key: m.path.slice(-60), data: m }));
      }
    }
  }
  if (input.ran?.speed) {
    for (const [path, s] of Object.entries(input.speed || {})) {
      const m = s.mobile;
      if (!m || m.score == null) continue;
      if (m.score < 50) out.push(make('speed_poor', path, `${path} scores ${m.score}/100 for speed on mobile (PageSpeed Insights).`, { data: s }));
      else if (m.score < 80) out.push(make('speed_fair', path, `${path} scores ${m.score}/100 for speed on mobile.`, { data: s }));
      const cwv = [m.lcp > 4 && `LCP ${m.lcp.toFixed(1)} s (aim under 2.5)`, m.cls > 0.25 && `CLS ${m.cls.toFixed(2)} (aim under 0.1)`, m.inp > 500 && `INP ${Math.round(m.inp)} ms (aim under 200)`].filter(Boolean);
      if (cwv.length) out.push(make('cwv_poor', path, `Core Web Vitals on ${path} (mobile): ${cwv.join('; ')}.`, { data: s }));
    }
  }
  // ── Off-site and local: the Google Business Profile checklist stays until it is ticked off ("Mark as ignored": done). ──
  out.push(make('gbp_checklist', null, 'Check the Google Business Profile for Lobi Stars FC and McCarthy Stadium: name, address, phone, opening hours on matchdays, website link, photos and recent posts.'));
  // One issue per id (the last one wins).
  return [...new Map(out.map(i => [i.id, i])).values()];
}

/** Top opportunities: the issues worth most (impact × severity), at most one per type. */
export function opportunities(issues, n = 5) {
  const w = { critical: 4, high: 3, medium: 2, low: 1 };
  const seen = new Set();
  return [...issues].filter(i => i.status !== 'ignored' && i.type !== 'gbp_checklist').sort((a, b) => (b.impact * w[b.severity]) - (a.impact * w[a.severity]))
    .filter(i => !seen.has(i.type) && seen.add(i.type)).slice(0, n);
}
