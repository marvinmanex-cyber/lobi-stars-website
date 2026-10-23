// SEO Scanner: our own polite crawler of OUR website only. At most 2 requests
// a second, robots.txt honoured (as "LobiStarsSEOScanner"; the private areas are
// only checked to confirm they stay hidden), redirects followed by hand so chains
// and loops are seen. analysePage() turns one page's HTML into the small set of
// facts the checks need (stored in seo_pages.data), so no page is read twice.
export const UA = 'LobiStarsSEOScanner/1.0 (+https://lobistarsfc.com/; our own site checker)';
export const MIN_GAP_MS = 500;              // ≤ 2 requests a second
export const MAX_PAGES = 300;
export const PAGES_PER_STEP = 3;            // Cloudflare free plan: about 10 ms of work per request
export const LINKS_PER_STEP = 10;
// Areas that must never be on Google (checked for noindex / sign-in, never crawled further).
// (/kitchen/ is the public MatchDay Kitchen food ordering page; the staff screen is in the admin.)
export const PRIVATE_PATHS = ['/admin/', '/staff/squad-data/', '/helper/', '/scan/', '/fans/'];
export const isPrivate = p => /^\/(admin|staff|helper|scan|fans|api|payment|unsubscribe)(\/|$)/.test(p);
// /shop and /shop/ are the same page (Cloudflare adds the slash): always compare with the slash.
export const slashed = p => /\.[a-z0-9]{2,5}$/i.test(p) || p.endsWith('/') ? p : `${p}/`;
const ourHost = (u, site) => u.origin === site.origin || u.hostname === `www.${site.hostname}` || /(^|\.)lobistarsfc\.com$/.test(u.hostname);
const SKIP_EXT = /\.(pdf|ics|xml|json|jpe?g|png|webp|gif|svg|mp3|mp4|zip|txt|js|css|webmanifest)$/i;

const sleep = ms => new Promise(r => setTimeout(r, ms));
let lastAt = 0;
/** One polite request (waits so requests are at least MIN_GAP_MS apart). */
export async function politeFetch(url, init = {}, ms = 12000) {
  const wait = lastAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastAt = Date.now();
  const t0 = Date.now();
  try {
    const res = await fetch(url, { redirect: 'manual', ...init, headers: { 'User-Agent': UA, ...(init.headers || {}) }, signal: AbortSignal.timeout(ms) });
    return { res, ms: Date.now() - t0 };
  } catch (e) { return { res: null, ms: Date.now() - t0, error: e?.name === 'TimeoutError' ? 'timed out' : 'could not connect' }; }
}
const drain = async res => { try { await res?.body?.cancel(); } catch {} };

/** Follows redirects one hop at a time (max 6). { status, final, hops: [{ from, to, status }], loop, res, ms } */
export async function fetchFollow(origin, path, { method = 'GET' } = {}) {
  const hops = [], seen = new Set();
  let url = new URL(path, origin).toString(), totalMs = 0;
  for (let i = 0; i < 7; i++) {
    const f = await politeFetch(url, { method });
    totalMs += f.ms;
    if (!f.res) return { status: 0, error: f.error, hops, final: url, ms: totalMs };
    const st = f.res.status;
    if (st >= 300 && st < 400 && f.res.headers.get('Location')) {
      await drain(f.res);
      const next = new URL(f.res.headers.get('Location'), url).toString();
      hops.push({ from: new URL(url).pathname, to: new URL(next).origin === new URL(origin).origin ? new URL(next).pathname : next, status: st });
      if (seen.has(next) || next === url) return { status: st, loop: true, hops, final: next, ms: totalMs };
      seen.add(url);
      url = next;
      continue;
    }
    return { status: st, hops, final: url, res: f.res, ms: totalMs };
  }
  return { status: 310, loop: true, hops, final: url, ms: totalMs };
}

// ── robots.txt ──
/** The rules for our crawler (its own group, else "*"). { disallow: [], allow: [], sitemaps: [], blocksAll, raw } */
export function parseRobots(txt) {
  const groups = [], sitemaps = [];
  let cur = null, lastWasAgent = false;
  for (const raw of String(txt || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'sitemap') { sitemaps.push(v); continue; }
    if (k === 'user-agent') { if (!lastWasAgent || !cur) { cur = { agents: [], allow: [], disallow: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasAgent = true; continue; }
    lastWasAgent = false;
    if (!cur) continue;
    if (k === 'disallow' && v) cur.disallow.push(v);
    if (k === 'allow' && v) cur.allow.push(v);
  }
  const pick = name => groups.find(g => g.agents.some(a => a !== '*' && name.toLowerCase().includes(a))) || groups.find(g => g.agents.includes('*')) || { allow: [], disallow: [] };
  const mine = pick('lobistarsseoscanner'), google = pick('googlebot');
  return { disallow: mine.disallow, allow: mine.allow, google, sitemaps, blocksAll: google.disallow.some(d => d === '/' || d === '/*') && !google.allow.some(a => a === '/'), raw: String(txt || '') };
}
const ruleMatch = (rule, path) => {
  const re = new RegExp('^' + rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
  return re.test(path);
};
/** Is a path allowed for a group (longest matching rule wins; Allow wins a tie). */
export function allowedBy(group, path) {
  let best = { len: -1, allow: true };
  for (const r of group.disallow || []) if (ruleMatch(r, path) && r.length > best.len) best = { len: r.length, allow: false };
  for (const r of group.allow || []) if (ruleMatch(r, path) && r.length >= best.len) best = { len: r.length, allow: true };
  return best.allow;
}

// ── sitemap.xml ──
export function parseSitemap(xml) {
  const out = [];
  for (const m of String(xml || '').matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = m[1].match(/<loc>\s*([^<\s]+)\s*<\/loc>/)?.[1];
    if (!loc) continue;
    try { out.push({ path: new URL(loc).pathname, lastmod: m[1].match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/)?.[1] || null }); } catch {}
  }
  return out;
}

// ── One page ──
const decode = s => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
export const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')); return m ? decode(m[1] ?? m[2] ?? m[3] ?? '') : null; };
const metaContent = (head, key, by = 'name') => {
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) if ((attr(m[0], by) || '').toLowerCase() === key) return attr(m[0], 'content');
  return null;
};
const textOf = html => decode(html.replace(/<(script|style|noscript|template|svg|nav|header|footer)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
/** A short fingerprint of the main text (for near-duplicates): 8 hashes of word groups. */
function fingerprint(words) {
  const h = s => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
  const shingles = new Set();
  for (let i = 0; i + 5 <= Math.min(words.length, 600); i += 2) shingles.add(h(words.slice(i, i + 5).join(' ')));
  return [...shingles].sort((a, b) => a - b).slice(0, 24);
}
export const similarity = (a, b) => { if (!a?.length || !b?.length) return 0; const B = new Set(b); return a.filter(x => B.has(x)).length / Math.max(a.length, b.length); };

/**
 * The facts about one page the checks use. Kept small (seo_pages.data).
 * origin: 'https://lobistarsfc.com'; path: '/news/x/'; headers: the response headers.
 */
export function analysePage(html, { origin, path, headers = new Headers() }) {
  const site = new URL(origin);
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd > 0 ? html.slice(0, headEnd) : html.slice(0, 30000);
  const body = html.slice(headEnd > 0 ? headEnd : 0);
  const markup = body.replace(/<(script|template)\b[\s\S]*?<\/\1>/gi, '');
  const title = decode(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim();
  const robotsMeta = `${metaContent(head, 'robots') || ''} ${headers.get('X-Robots-Tag') || ''}`.toLowerCase();
  const canonical = (() => { const t = [...head.matchAll(/<link\b[^>]*>/gi)].map(m => m[0]).find(t => (attr(t, 'rel') || '').toLowerCase() === 'canonical'); return t ? attr(t, 'href') : null; })();
  const hreflang = [...head.matchAll(/<link\b[^>]*>/gi)].map(m => m[0]).filter(t => (attr(t, 'rel') || '').toLowerCase() === 'alternate' && attr(t, 'hreflang')).map(t => attr(t, 'hreflang'));
  const headings = [...markup.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map(m => ({ level: Number(m[1]), text: textOf(m[2]).slice(0, 120) }));
  let headingSkip = false;
  for (let i = 1; i < headings.length; i++) if (headings[i].level > headings[i - 1].level + 1) { headingSkip = true; break; }
  // Structured data (JSON-LD): the types found and whether each block is valid JSON.
  const schemaTypes = new Set(), schemaErrors = [];
  let sameAs = false;
  for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const d = JSON.parse(m[1]);
      const walk = o => { if (Array.isArray(o)) return o.forEach(walk); if (!o || typeof o !== 'object') return; const t = o['@type']; (Array.isArray(t) ? t : t ? [t] : []).forEach(x => schemaTypes.add(String(x))); if (Array.isArray(o.sameAs) ? o.sameAs.length : o.sameAs) sameAs = true; if (o['@graph']) walk(o['@graph']); };
      walk(d);
      const list = Array.isArray(d) ? d : d['@graph'] || [d];
      for (const o of list) {
        const t = String(o?.['@type'] || '');
        if (t === 'NewsArticle' && (!o.headline || !o.datePublished)) schemaErrors.push('NewsArticle without headline or datePublished');
        if (t === 'SportsEvent' && (!o.name || !o.startDate)) schemaErrors.push('SportsEvent without name or startDate');
        if (t === 'Person' && !o.name) schemaErrors.push('Person without name');
        if (!o?.['@context'] && !d['@context']) schemaErrors.push(`${t || 'Block'} without @context`);
      }
    } catch { schemaErrors.push('A JSON-LD block is not valid JSON'); }
  }
  // Images (in the page itself).
  const images = [];
  for (const m of markup.matchAll(/<img\b[^>]*>/gi)) {
    const src = attr(m[0], 'src');
    if (!src || /^data:/i.test(src)) continue;
    let p; try { const u = new URL(src, origin + path); if (u.origin !== site.origin) continue; p = decodeURI(u.pathname); } catch { continue; }
    const alt = attr(m[0], 'alt');
    images.push({ src: p, alt: alt === null ? null : alt.trim(), sized: !!(attr(m[0], 'width') && attr(m[0], 'height')), webp: /\.webp$/i.test(p) || /<picture/i.test(markup.slice(Math.max(0, m.index - 300), m.index)) });
    if (images.length >= 60) break;
  }
  // Links.
  const internal = new Set(), external = new Set();
  for (const m of markup.matchAll(/<a\b[^>]*>/gi)) {
    const href = attr(m[0], 'href');
    if (!href || /^(mailto:|tel:|#|javascript:|data:|sms:|whatsapp:)/i.test(href)) continue;
    try {
      const u = new URL(href, origin + path);
      if (ourHost(u, site)) { if (!isPrivate(u.pathname) && !SKIP_EXT.test(u.pathname)) internal.add(slashed(u.pathname)); }
      else if (/^https?:$/.test(u.protocol)) external.add(u.origin + u.pathname);
    } catch {}
  }
  // Insecure (http://) pictures, scripts, styles and frames on the page (mixed content).
  // (Not checked when the scanner itself runs over http://, i.e. on a test computer; <link rel="canonical"> is not a file.)
  const insecure = site.protocol !== 'https:' ? [] : [...html.matchAll(/<(img|script|link|iframe|source|video|audio)\b[^>]*\s(src|href|srcset)=["']http:\/\/[^"']+/gi)]
    .filter(m => !/^<link\b/i.test(m[0]) || /rel=["']?(stylesheet|preload|icon|modulepreload)/i.test(m[0])).map(m => m[0].match(/http:\/\/[^"'\s]+/)[0]).slice(0, 10);
  const text = textOf(markup);
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const firstPara = textOf(markup.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '').slice(0, 300);
  return {
    title, titleLen: title.length,
    desc: (metaContent(head, 'description') || '').trim(),
    h1: headings.filter(h => h.level === 1).map(h => h.text),
    headingSkip,
    noindex: /noindex/.test(robotsMeta),
    canonical: canonical ? (() => { try { const u = new URL(canonical, origin); return ourHost(u, site) ? u.pathname : u.toString(); } catch { return canonical; } })() : null,
    viewport: !!metaContent(head, 'viewport'),
    og: { title: !!metaContent(head, 'og:title', 'property'), desc: !!metaContent(head, 'og:description', 'property'), image: !!metaContent(head, 'og:image', 'property') },
    twitter: !!metaContent(head, 'twitter:card'),
    hreflang,
    schema: [...schemaTypes], sameAs, schemaErrors: [...new Set(schemaErrors)].slice(0, 5),
    images, links: [...internal].slice(0, 150), external: [...external].slice(0, 40), insecure,
    wordCount: words.length, firstPara, textSample: /^\/news\/[^/]+\/$/.test(path) ? text.slice(0, 4000) : undefined, fp: fingerprint(words),
    published: metaContent(head, 'article:published_time', 'property'),
    modified: metaContent(head, 'article:modified_time', 'property'),
    kb: Math.round(html.length / 1024),
  };
}

/** The pages to scan: the sitemap, then links found on pages (same site, public, robots-allowed). */
export function nextQueue(state, links, robots) {
  for (const l of links) {
    if (state.queue.length >= MAX_PAGES) break;
    if (!state.queue.includes(l) && !isPrivate(l) && allowedBy(robots, l)) state.queue.push(l);
  }
}
export { drain, sleep };
