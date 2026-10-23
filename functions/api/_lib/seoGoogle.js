// SEO Scanner: official data sources only. Google Search Console (the service
// account already used by Analytics), Google PageSpeed Insights, and optionally
// a licensed rank-tracking API (DataForSEO or SerpApi; off by default). Google
// search results are NEVER scraped. Keys stay in the environment and are never
// shown. With ANALYTICS_SYNC_FAKE=1 (local tests) made-up figures are returned.
import { serviceAccount, signedAssertion } from './googleAuth.js';
import { aiReady } from './claude.js';
import { githubReady } from './github.js';
import { ensureSeoSchema, getSeoSettings, lagosDay, parse } from './seoStore.js';

export const siteUrlGsc = env => String(env.GSC_SITE_URL || 'sc-domain:lobistarsfc.com').trim();
const fake = env => ['1', 'true'].includes(String(env.ANALYTICS_SYNC_FAKE || env.SEO_FAKE || '').toLowerCase());
const SITE = env => String(env.SITE_URL || 'https://lobistarsfc.com').replace(/\/+$/, '');
const tokens = new Map();
/** An access token for a Google scope (read-only by default; submitting a sitemap needs "webmasters"). */
async function token(env, scope = 'https://www.googleapis.com/auth/webmasters.readonly') {
  const sa = serviceAccount(env);
  if (sa.error) throw new Error(sa.error);
  const c = tokens.get(scope);
  if (c && c.until > Date.now() + 300000 && c.email === sa.email) return c.token;
  const r = await fetch(sa.tokenUri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await signedAssertion(sa, Math.floor(Date.now() / 1000), scope) }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(`Google sign-in failed (${r.status}): ${String(d.error_description || d.error || '').slice(0, 160)}`);
  tokens.set(scope, { token: d.access_token, until: Date.now() + (Number(d.expires_in) || 3600) * 1000, email: sa.email });
  return d.access_token;
}
async function gjson(env, url, init = {}, scope) {
  const t = await token(env, scope);
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...(init.headers || {}) }, signal: AbortSignal.timeout(20000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google answered ${r.status}: ${String(d.error?.message || '').slice(0, 200)}`);
  return d;
}

// ── Connection status (Settings › SEO Scanner › Connections) ──
export async function connections(env) {
  const db = env.DB;
  await ensureSeoSchema(db);
  const s = await getSeoSettings(db);
  const sa = serviceAccount(env);
  const last = await db.prepare(`SELECT MAX(date) AS d FROM gsc_daily WHERE dim = 'total'`).first().catch(() => null);
  const lastRank = await db.prepare(`SELECT MAX(date) AS d FROM seo_ranks`).first().catch(() => null);
  const lastSpeed = await db.prepare(`SELECT MAX(date) AS d FROM seo_speed`).first().catch(() => null);
  const provider = s.rank_provider;
  const rankKey = provider === 'dataforseo' ? !!(env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD) : provider === 'serpapi' ? !!env.SERPAPI_KEY : false;
  return {
    gsc: { connected: fake(env) || !sa.error, serviceAccount: sa.error ? null : sa.email, property: siteUrlGsc(env), lastDataDate: last?.d || null, lastKeywordData: lastRank?.d || null, problem: sa.error || null },
    pagespeed: { connected: fake(env) || !!env.PAGESPEED_API_KEY, lastRun: lastSpeed?.d || null, note: env.PAGESPEED_API_KEY ? null : 'Works without a key at a very low daily limit; add PAGESPEED_API_KEY for the weekly checks.' },
    rank: { provider, connected: provider !== 'off' && rankKey, country: s.rank_country, language: s.rank_language },
    ai: { connected: aiReady(env) },
    github: { connected: fake(env) || githubReady(env) },
    rebuild: { connected: !!env.PAGES_DEPLOY_HOOK },
  };
}

// ── Search Console: the target keywords, per day, page and device ──
const dayStr = d => d.toISOString().slice(0, 10);
/** Daily figures for one keyword over the last `days` days: [{ date, device, page, clicks, impressions, position }]. */
export async function keywordRows(env, keyword, days = 7) {
  const end = new Date(Date.now() - 2 * 864e5), start = new Date(end.getTime() - (days - 1) * 864e5);
  if (fake(env)) {
    const seed = [...keyword].reduce((a, c) => a + c.charCodeAt(0), 0);
    const out = [];
    for (let i = 0; i < days; i++) for (const device of ['MOBILE', 'DESKTOP']) {
      const date = dayStr(new Date(start.getTime() + i * 864e5));
      out.push({ date, device, page: `${SITE(env)}/`, clicks: (seed + i) % 9, impressions: 40 + ((seed * (i + 1)) % 60), position: Math.max(1, ((seed % 18) + 1) + (i % 3) - 1 + (device === 'MOBILE' ? 0.4 : 0)) });
    }
    return out;
  }
  const d = await gjson(env, `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrlGsc(env))}/searchAnalytics/query`, { method: 'POST',
    body: JSON.stringify({ startDate: dayStr(start), endDate: dayStr(end), dimensions: ['date', 'page', 'device'], rowLimit: 500,
      dimensionFilterGroups: [{ filters: [{ dimension: 'query', operator: 'equals', expression: keyword.toLowerCase() }] }] }) });
  return (d.rows || []).map(r => ({ date: r.keys[0], page: r.keys[1], device: r.keys[2], clicks: r.clicks, impressions: r.impressions, position: r.position }));
}
/** Stores one keyword's Search Console figures: per day the best page, and totals per device and for all devices. */
export async function importKeyword(env, keyword, days = 7) {
  const db = env.DB;
  const rows = await keywordRows(env, keyword, days);
  const groups = new Map();
  for (const r of rows) for (const dev of [r.device.toLowerCase(), 'all']) {
    const k = `${r.date}|${dev}`;
    const g = groups.get(k) || { date: r.date, device: dev, clicks: 0, impressions: 0, posW: 0, pages: new Map() };
    g.clicks += r.clicks; g.impressions += r.impressions; g.posW += r.position * Math.max(1, r.impressions);
    g.pages.set(r.page, (g.pages.get(r.page) || 0) + r.impressions);
    groups.set(k, g);
  }
  const stmts = [...groups.values()].map(g => {
    const page = [...g.pages.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const path = page ? new URL(page).pathname : null;
    return db.prepare(`INSERT INTO seo_ranks (date, keyword, source, device, page, position, clicks, impressions) VALUES (?, ?, 'gsc', ?, ?, ?, ?, ?)
      ON CONFLICT (date, keyword, source, device) DO UPDATE SET page = excluded.page, position = excluded.position, clicks = excluded.clicks, impressions = excluded.impressions`)
      .bind(g.date, keyword, g.device, path, Math.round((g.posW / Math.max(1, g.impressions)) * 10) / 10, g.clicks, g.impressions);
  });
  if (stmts.length) await db.batch(stmts);
  return stmts.length;
}

// ── Search Console: index status of a page, and the sitemap ──
export async function inspectUrl(env, path) {
  if (fake(env)) return { verdict: path.includes('not-indexed') ? 'NEUTRAL' : 'PASS', coverage: path.includes('not-indexed') ? 'Discovered - currently not indexed' : 'Submitted and indexed', lastCrawl: new Date().toISOString(), robots: 'ALLOWED', indexing: 'INDEXING_ALLOWED' };
  const d = await gjson(env, 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', { method: 'POST', body: JSON.stringify({ inspectionUrl: `${SITE(env)}${path}`, siteUrl: siteUrlGsc(env) }) });
  const r = d.inspectionResult?.indexStatusResult || {};
  return { verdict: r.verdict, coverage: r.coverageState, lastCrawl: r.lastCrawlTime, robots: r.robotsTxtState, indexing: r.indexingState, fetch: r.pageFetchState };
}
export async function sitemapStatus(env) {
  if (fake(env)) return [{ path: `${SITE(env)}/sitemap.xml`, lastSubmitted: new Date(Date.now() - 864e5).toISOString(), lastDownloaded: new Date().toISOString(), errors: 0, warnings: 0, isPending: false }];
  const d = await gjson(env, `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrlGsc(env))}/sitemaps`);
  return (d.sitemap || []).map(m => ({ path: m.path, lastSubmitted: m.lastSubmitted, lastDownloaded: m.lastDownloaded, errors: Number(m.errors) || 0, warnings: Number(m.warnings) || 0, isPending: !!m.isPending }));
}
/** Resubmits sitemap.xml. Needs the service account to have Full permission on the property (read-only access cannot submit). */
export async function submitSitemap(env) {
  if (fake(env)) return { ok: true };
  try {
    const t = await token(env, 'https://www.googleapis.com/auth/webmasters');
    const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrlGsc(env))}/sitemaps/${encodeURIComponent(`${SITE(env)}/sitemap.xml`)}`, { method: 'PUT', headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(15000) });
    if (r.ok) return { ok: true };
    return { ok: false, error: r.status === 403 ? 'Google refused: give the service account "Full" permission in Search Console (Settings › Users and permissions) so it can resubmit the sitemap.' : `Google answered ${r.status}.` };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 200) }; }
}

// ── PageSpeed Insights (mobile and desktop; Core Web Vitals) ──
export const SPEED_PAGES = ['/', '/news/', 'news-article', '/fixtures/', '/table/', '/squad/', 'player-page', '/shop/', '/tickets/'];
export async function pageSpeed(env, path, strategy = 'mobile') {
  if (fake(env)) { const seed = [...path].length * (strategy === 'mobile' ? 3 : 5); return { score: strategy === 'mobile' ? 60 + (seed % 30) : 80 + (seed % 15), lcp: 1.8 + (seed % 20) / 10, inp: 120 + seed, cls: (seed % 12) / 100, fcp: 1.2 }; }
  const u = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  u.searchParams.set('url', `${SITE(env)}${path}`); u.searchParams.set('strategy', strategy); u.searchParams.set('category', 'performance');
  if (env.PAGESPEED_API_KEY) u.searchParams.set('key', env.PAGESPEED_API_KEY);
  const r = await fetch(u, { signal: AbortSignal.timeout(60000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`PageSpeed answered ${r.status}: ${String(d.error?.message || '').slice(0, 160)}`);
  const a = d.lighthouseResult?.audits || {}, field = d.loadingExperience?.metrics || {};
  return {
    score: Math.round((d.lighthouseResult?.categories?.performance?.score ?? 0) * 100),
    lcp: (a['largest-contentful-paint']?.numericValue || 0) / 1000,
    inp: field.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
    cls: a['cumulative-layout-shift']?.numericValue ?? null,
    fcp: (a['first-contentful-paint']?.numericValue || 0) / 1000,
  };
}
export async function saveSpeed(db, path, strategy, m) {
  await db.prepare(`INSERT INTO seo_speed (date, path, strategy, score, lcp, inp, cls, fcp) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (date, path, strategy) DO UPDATE SET score = excluded.score, lcp = excluded.lcp, inp = excluded.inp, cls = excluded.cls, fcp = excluded.fcp`)
    .bind(lagosDay(), path, strategy, m.score, m.lcp, m.inp, m.cls, m.fcp).run();
}

// ── Optional licensed rank tracker (off by default; Nigeria, English, mobile and desktop) ──
export async function licensedRank(env, provider, keyword, device) {
  const domain = 'lobistarsfc.com';
  if (fake(env)) return { position: 3 + (keyword.length % 9), url: `${SITE(env)}/` };
  if (provider === 'serpapi') {
    if (!env.SERPAPI_KEY) throw new Error('SERPAPI_KEY is not set.');
    const u = new URL('https://serpapi.com/search.json');
    for (const [k, v] of Object.entries({ engine: 'google', q: keyword, gl: 'ng', hl: 'en', google_domain: 'google.com.ng', device: device === 'mobile' ? 'mobile' : 'desktop', num: '50', api_key: env.SERPAPI_KEY })) u.searchParams.set(k, v);
    const d = await (await fetch(u, { signal: AbortSignal.timeout(30000) })).json();
    const hit = (d.organic_results || []).find(o => String(o.link || '').includes(domain));
    return { position: hit?.position ?? null, url: hit?.link || null };
  }
  if (provider === 'dataforseo') {
    if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) throw new Error('DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD are not set.');
    const r = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/regular', { method: 'POST', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Basic ${btoa(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ keyword, location_name: 'Nigeria', language_name: 'English', device, depth: 50 }]) });
    const d = await r.json();
    const items = d.tasks?.[0]?.result?.[0]?.items || [];
    const hit = items.find(i => i.type === 'organic' && String(i.domain || '').includes(domain));
    return { position: hit?.rank_group ?? null, url: hit?.url || null };
  }
  return { position: null, url: null };
}
export async function saveLicensedRank(db, keyword, provider, device, r) {
  await db.prepare(`INSERT INTO seo_ranks (date, keyword, source, device, page, position) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (date, keyword, source, device) DO UPDATE SET page = excluded.page, position = excluded.position`)
    .bind(lagosDay(), keyword, provider, device, r.url ? new URL(r.url).pathname : null, r.position).run();
}
export { fake as seoFake, parse };
