// SEO Scanner: scans, run in small steps (one step per request, like Website
// Health) so nothing goes over Cloudflare's limits.
//   - full scan every day at 03:00 Nigeria time (Search Console figures daily,
//     PageSpeed weekly, the licensed rank tracker daily if it is switched on);
//   - quick scan of new or changed pages within about 10 minutes of them appearing
//     in sitemap.xml (a news story published), and of a page again after a fix;
//   - "Scan now" and "Check again" from the dashboard.
// The cron Worker calls /api/internal/health-check every minute; when Website
// Health has nothing running, that request does one SEO step (seoTick).
import { ensureSeoSchema, getSeoSettings, setSeoSetting, listKeywords, lagosDay, parse } from './seoStore.js';
import { computeIssues } from './seoAnalyse.js';
import { info, healthScore, countBySeverity, CATEGORIES } from './seoChecks.js';
import { fetchFollow, politeFetch, drain, parseRobots, parseSitemap, analysePage, allowedBy, nextQueue, isPrivate, PRIVATE_PATHS, PAGES_PER_STEP, LINKS_PER_STEP, MAX_PAGES } from './seoCrawl.js';
import { connections, importKeyword, inspectUrl, sitemapStatus, pageSpeed, saveSpeed, SPEED_PAGES, licensedRank, saveLicensedRank, seoFake } from './seoGoogle.js';
import { superAdminEmails } from './superAdmins.js';
import { sendEmail } from './email.js';

const LOCK_MS = 90 * 1000, STALE_MS = 10 * 60 * 1000;
const iso = () => new Date().toISOString();
const sid = () => `seo_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const lagosHour = (t = Date.now()) => new Date(t + 3600e3).getUTCHours();
// Issue types worked out page by page (a quick scan of a page re-checks only these, for that page).
const PAGE_TYPES = ['http_error', 'redirect_chain', 'redirect_loop', 'title_missing', 'title_duplicate', 'title_length', 'desc_missing', 'desc_duplicate', 'desc_length', 'h1_missing', 'h1_multiple',
  'heading_order', 'img_alt', 'img_size_attr', 'canonical_missing', 'canonical_wrong', 'noindex_public', 'viewport_missing', 'social_tags', 'hreflang_invalid', 'https_problem', 'schema_invalid', 'schema_missing',
  'thin_page', 'news_player_links', 'keyword_missing'];
export const STEP_LABEL = { plan: 'Reading robots.txt and the sitemap', crawl: 'Checking pages', private: 'Checking private areas stay hidden', links: 'Checking links and pictures', stale: 'Fixtures and table',
  gsc: 'Google Search Console: keywords', index: 'Google Search Console: indexing', speed: 'PageSpeed Insights', rank: 'Rank tracker', finish: 'Working out the results' };

export function progressOf(r) {
  const st = parse(r.state, {});
  const steps = st.steps || [];
  return { id: r.id, kind: r.kind, trigger: r.trigger, startedBy: r.started_by, startedAt: r.started_at, finishedAt: r.finished_at, done: !!r.finished_at,
    step: Math.min(st.i || 0, steps.length), steps: steps.length, current: r.finished_at ? null : STEP_LABEL[steps[st.i || 0]] || '',
    pagesDone: st.idx || 0, pagesTotal: (st.queue || []).length, pages: r.pages || 0, score: r.score, counts: parse(r.counts), summary: parse(r.summary) };
}

async function activeScan(db) {
  const r = await db.prepare(`SELECT * FROM seo_scans WHERE finished_at IS NULL ORDER BY started_at DESC LIMIT 1`).first();
  if (!r) return null;
  if (Date.now() - Date.parse(r.updated_at || r.started_at) > STALE_MS) {
    await db.prepare(`UPDATE seo_scans SET finished_at = ?, summary = ? WHERE id = ?`).bind(iso(), JSON.stringify({ abandoned: true }), r.id).run();
    return null;
  }
  return r;
}

/** Starts a scan (or returns the one running). kind: full | quick. paths: the pages for a quick scan. */
export async function startScan(env, { kind = 'full', trigger = 'manual', by = null, paths = [], speed = null } = {}) {
  const db = env.DB;
  await ensureSeoSchema(db);
  const busy = await activeScan(db);
  if (busy) return { scan: progressOf(busy), already: true };
  const s = await getSeoSettings(db);
  const conn = await connections(env);
  let steps;
  if (kind === 'quick') {
    const q = [...new Set(paths.map(p => String(p || '').replace(/[?#].*$/, '')).filter(p => p.startsWith('/') && !isPrivate(p)))].slice(0, 10);
    if (!q.length) return { error: 'No page to check.' };
    steps = ['crawl', 'links', 'finish'];
    const state = { steps, i: 0, queue: q, idx: 0, quick: true, ran: { crawl: true }, sitemap: trigger === 'published' ? q.map(path => ({ path })) : undefined };
    return insertScan(db, kind, trigger, by, state);
  }
  const lastSpeed = await db.prepare(`SELECT MAX(date) AS d FROM seo_speed`).first();
  const speedDue = speed ?? (!lastSpeed?.d || Date.now() - Date.parse(lastSpeed.d) > 6 * 864e5);
  steps = ['plan', 'crawl', 'private', 'links', 'stale'];
  if (conn.gsc.connected) steps.push('gsc', 'index');
  if (speedDue) steps.push('speed');
  if (conn.rank.connected) steps.push('rank');
  steps.push('finish');
  return insertScan(db, kind, trigger, by, { steps, i: 0, queue: [], idx: 0, ran: {}, provider: conn.rank.connected ? s.rank_provider : null });
}
async function insertScan(db, kind, trigger, by, state) {
  const id = sid(), now = iso();
  await db.prepare(`INSERT INTO seo_scans (id, kind, trigger, started_at, updated_at, started_by, state) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, kind, trigger, now, now, by, JSON.stringify(state)).run();
  return { scan: progressOf(await db.prepare(`SELECT * FROM seo_scans WHERE id = ?`).bind(id).first()), already: false };
}

/** One step of a scan. */
export async function stepScan(env, origin, id) {
  const db = env.DB;
  await ensureSeoSchema(db);
  const t = Date.now();
  const claim = await db.prepare(`UPDATE seo_scans SET lock_until = ? WHERE id = ? AND finished_at IS NULL AND (lock_until IS NULL OR lock_until < ?)`).bind(t + LOCK_MS, id, t).run();
  const r = await db.prepare(`SELECT * FROM seo_scans WHERE id = ?`).bind(id).first();
  if (!r) return { error: 'Not found' };
  if (!claim.meta?.changes) return { scan: progressOf(r), busy: !r.finished_at };
  const st = parse(r.state, {});
  const step = st.steps[st.i] || 'finish';
  let again = false;
  try {
    if (step === 'finish') {
      const out = await finishScan(env, r, st);
      await db.prepare(`UPDATE seo_scans SET finished_at = ?, updated_at = ?, state = ?, pages = ?, score = ?, counts = ?, summary = ?, lock_until = NULL WHERE id = ?`)
        .bind(iso(), iso(), JSON.stringify({ steps: st.steps, i: st.steps.length, queue: [], idx: st.idx }), out.pages, out.score, JSON.stringify(out.counts), JSON.stringify(out.summary), id).run();
      return { scan: progressOf(await db.prepare(`SELECT * FROM seo_scans WHERE id = ?`).bind(id).first()), result: out };
    }
    again = await STEPS[step]({ env, db, origin, st, scan: r });
  } catch (err) {
    console.error('[seo] step', step, err);
    (st.errors ||= []).push(`${STEP_LABEL[step] || step}: ${String(err.message || err).slice(0, 200)}`);
    again = false;
  }
  if (!again) st.i++;
  await db.prepare(`UPDATE seo_scans SET state = ?, updated_at = ?, lock_until = NULL, pages = ? WHERE id = ?`).bind(JSON.stringify(st), iso(), st.idx || 0, id).run();
  return { scan: progressOf(await db.prepare(`SELECT * FROM seo_scans WHERE id = ?`).bind(id).first()) };
}

const STEPS = {
  async plan({ origin, st }) {
    const rb = await politeFetch(`${origin}/robots.txt`);
    let robots = parseRobots('');
    st.robotsOk = !!rb.res?.ok;
    if (rb.res?.ok) robots = parseRobots(await rb.res.text()); else await drain(rb.res);
    st.robots = { disallow: robots.disallow, allow: robots.allow, google: robots.google, sitemaps: robots.sitemaps, blocksAll: robots.blocksAll };
    const sm = await politeFetch(`${origin}/sitemap.xml`);
    let list = [];
    if (sm.res?.ok) list = parseSitemap(await sm.res.text()); else await drain(sm.res);
    st.sitemap = list.slice(0, MAX_PAGES).map(x => ({ path: x.path, lastmod: x.lastmod }));
    // Every address in the sitemap (for "missing from the sitemap"), unless it is huge.
    st.sitemapAll = list.length <= 4000 ? list.map(x => x.path) : null;
    st.queue = ['/', ...st.sitemap.map(x => x.path)].filter((p, i, a) => a.indexOf(p) === i && allowedBy(st.robots, p)).slice(0, MAX_PAGES);
    st.idx = 0;
    st.ran.crawl = true;
  },
  async crawl({ db, origin, st }) {
    const batch = st.queue.slice(st.idx, st.idx + PAGES_PER_STEP);
    const sitemap = new Map((st.sitemap || []).map(x => [x.path, x.lastmod]));
    st.linkFrom ||= {}; st.img ||= []; st.ext ||= {};
    const writes = [];
    for (const path of batch) {
      const f = await fetchFollow(origin, path);
      const data = { hops: f.hops, loop: !!f.loop, error: f.error || null, ms: f.ms };
      if (f.res && f.status === 200 && /html/i.test(f.res.headers.get('Content-Type') || '')) {
        Object.assign(data, analysePage(await f.res.text(), { origin, path, headers: f.res.headers }));
        for (const l of data.links) {
          if (l === path) continue;
          const from = (st.linkFrom[l] ||= []);
          if (from.length < 10 && !from.includes(path)) from.push(path);
        }
        if (!st.quick) nextQueue(st, data.links, st.robots || { disallow: [], allow: [] });
        for (const i of data.images) if (st.img.length < 60 && !st.img.includes(i.src)) st.img.push(i.src);
        for (const e of data.external) if (Object.keys(st.ext).length < 30 && !st.ext[e]) st.ext[e] = path;
      } else await drain(f.res);
      if (!sitemap.has(path) && path !== '/' && !st.quick) data.linkOnly = true;
      writes.push(db.prepare(`INSERT INTO seo_pages (path, status, scanned_at, in_sitemap, lastmod, data) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (path) DO UPDATE SET status = excluded.status, scanned_at = excluded.scanned_at, in_sitemap = CASE WHEN ? THEN seo_pages.in_sitemap ELSE excluded.in_sitemap END, lastmod = COALESCE(excluded.lastmod, seo_pages.lastmod), data = excluded.data`)
        .bind(path, f.status || 0, iso(), sitemap.has(path) || path === '/' ? 1 : 0, sitemap.get(path) || null, JSON.stringify(data), st.quick ? 1 : 0));
    }
    if (writes.length) await db.batch(writes);
    st.idx += batch.length;
    return st.idx < st.queue.length;
  },
  // Private areas: one request each, only to confirm they ask for a sign-in or say "noindex" (our own site;
  // robots.txt keeps search engines out of them, which is exactly what is being confirmed).
  async private({ origin, st }) {
    st.priv = {};
    for (const path of PRIVATE_PATHS) {
      const f = await fetchFollow(origin, path);
      let noindex = /noindex/i.test(f.res?.headers.get('X-Robots-Tag') || '');
      if (f.res && f.status === 200) noindex ||= /<meta[^>]+name=["']robots["'][^>]+noindex/i.test((await f.res.text()).slice(0, 20000)); else await drain(f.res);
      const toLogin = (f.hops || []).some(h => /login|sign-?in|portal/i.test(h.to));
      st.priv[path] = { status: f.status, noindex, hidden: noindex || toLogin || [401, 403, 404].includes(f.status) || f.status === 0 };
    }
  },
  async links({ origin, st }) {
    // Internal links that were not crawled (over the page limit), then picture sizes, then other websites.
    if (!st.linkPlan) {
      const crawled = new Set(st.queue);
      st.linkPlan = [
        ...Object.keys(st.linkFrom || {}).filter(l => !crawled.has(l)).slice(0, 60).map(l => ['link', l]),
        ...(st.img || []).map(src => ['img', src]),
        ...Object.keys(st.ext || {}).map(u => ['ext', u]),
      ];
      st.linkIdx = 0; st.linkStatus = {}; st.imgSize = {}; st.extStatus = {};
    }
    const batch = st.linkPlan.slice(st.linkIdx, st.linkIdx + LINKS_PER_STEP);
    for (const [kind, k] of batch) {
      if (kind === 'link') { const f = await fetchFollow(origin, k); st.linkStatus[k] = f.status; await drain(f.res); }
      else if (kind === 'img') { const f = await politeFetch(`${origin}${encodeURI(k)}`, { method: 'HEAD' }); st.imgSize[k] = Number(f.res?.headers.get('Content-Length')) || 0; await drain(f.res); }
      else {
        let f = await politeFetch(k, { method: 'HEAD', redirect: 'follow' }, 8000);
        if (f.res && [403, 405, 501].includes(f.res.status)) { await drain(f.res); f = await politeFetch(k, { redirect: 'follow' }, 8000); }
        // Only clear "gone" answers count as broken (many sites refuse automatic checks with 403/429).
        st.extStatus[k] = f.res ? f.res.status : 0;
        await drain(f.res);
      }
    }
    st.linkIdx += batch.length;
    return st.linkIdx < st.linkPlan.length;
  },
  async stale({ db, st }) {
    const now = Date.now();
    const ev = await db.prepare(`SELECT e.home_team, e.away_team, e.event_date, m.status FROM events e LEFT JOIN match_centre m ON m.event_id = e.id WHERE e.active = 1 AND e.event_date < ? ORDER BY e.event_date DESC LIMIT 20`)
      .bind(new Date(now - 6 * 3600e3).toISOString()).all().catch(() => ({ results: [] }));
    const lg = await db.prepare(`SELECT f.kickoff_at, h.name AS home, a.name AS away FROM league_fixtures f JOIN league_teams h ON h.id = f.home_team_id JOIN league_teams a ON a.id = f.away_team_id
      WHERE f.is_published = 1 AND f.status = 'scheduled' AND f.kickoff_at IS NOT NULL AND f.kickoff_at < ? ORDER BY f.kickoff_at DESC LIMIT 20`).bind(new Date(now - 72 * 3600e3).toISOString()).all().catch(() => ({ results: [] }));
    st.stale = {
      events: (ev.results || []).filter(e => Date.parse(e.event_date) < now - 6 * 3600e3 && !['full-time', 'postponed', 'cancelled', 'abandoned'].includes(e.status || '')).map(e => `${e.home_team} v ${e.away_team} (${lagosDay(Date.parse(e.event_date))})`),
      league: (lg.results || []).map(f => `${f.home} v ${f.away} (${String(f.kickoff_at).slice(0, 10)})`),
    };
  },
  async gsc({ env, db, st }) {
    const kws = (await listKeywords(db)).map(k => k.keyword);
    st.kwIdx ||= 0;
    const first = !(await db.prepare(`SELECT 1 FROM seo_ranks WHERE source = 'gsc' LIMIT 1`).first());
    for (const k of kws.slice(st.kwIdx, st.kwIdx + 5)) {
      try { await importKeyword(env, k, first ? 28 : 7); st.ran.gsc = true; } catch (err) { (st.errors ||= []).push(`Search Console ("${k}"): ${String(err.message || err).slice(0, 160)}`); break; }
    }
    st.kwIdx += 5;
    return st.kwIdx < kws.length && !(st.errors || []).some(e => e.startsWith('Search Console'));
  },
  async index({ env, db, st }) {
    if (!st.inspect) {
      const kws = await listKeywords(db);
      const news = (st.sitemap || []).filter(x => /^\/news\/[^/]+\/$/.test(x.path)).sort((a, b) => String(b.lastmod || '').localeCompare(String(a.lastmod || ''))).slice(0, 5).map(x => x.path);
      st.inspect = [...new Set(['/', '/news/', '/fixtures/', '/table/', '/squad/', '/tickets/', '/shop/', ...kws.map(k => k.target_path).filter(Boolean), ...news])].slice(0, 18);
      st.inspIdx = 0; st.inspections = {};
      try { st.sitemapGsc = await sitemapStatus(env); } catch (err) { (st.errors ||= []).push(`Search Console (sitemaps): ${String(err.message || err).slice(0, 160)}`); }
    }
    for (const p of st.inspect.slice(st.inspIdx, st.inspIdx + 5)) {
      try { st.inspections[p] = await inspectUrl(env, p); st.ran.index = true; } catch (err) { (st.errors ||= []).push(`URL inspection (${p}): ${String(err.message || err).slice(0, 160)}`); st.inspIdx = st.inspect.length; return false; }
    }
    st.inspIdx += 5;
    return st.inspIdx < st.inspect.length;
  },
  async speed({ env, db, st }) {
    if (!st.speedList) {
      const news = (st.sitemap || []).filter(x => /^\/news\/[^/]+\/$/.test(x.path)).sort((a, b) => String(b.lastmod || '').localeCompare(String(a.lastmod || '')))[0]?.path;
      const player = (st.sitemap || []).find(x => /^\/squad\/(?!staff\/)[^/]+\/$/.test(x.path))?.path;
      st.speedList = SPEED_PAGES.map(p => p === 'news-article' ? news : p === 'player-page' ? player : p).filter(Boolean);
      st.speedIdx = 0;
    }
    const p = st.speedList[st.speedIdx];
    if (p) {
      for (const strategy of ['mobile', 'desktop']) {
        try { await saveSpeed(db, p, strategy, await pageSpeed(env, p, strategy)); st.ran.speed = true; } catch (err) { (st.errors ||= []).push(`PageSpeed (${p}, ${strategy}): ${String(err.message || err).slice(0, 160)}`); if (/429|quota/i.test(String(err.message))) { st.speedIdx = st.speedList.length; return false; } }
      }
    }
    st.speedIdx++;
    return st.speedIdx < st.speedList.length;
  },
  async rank({ env, db, st }) {
    if (!st.provider) return false;
    const kws = (await listKeywords(db)).filter(k => k.confirmed).map(k => k.keyword);
    st.rankIdx ||= 0;
    for (const k of kws.slice(st.rankIdx, st.rankIdx + 3)) for (const device of ['mobile', 'desktop']) {
      try { await saveLicensedRank(db, k, st.provider, device, await licensedRank(env, st.provider, k, device)); } catch (err) { (st.errors ||= []).push(`Rank tracker ("${k}"): ${String(err.message || err).slice(0, 160)}`); st.rankIdx = kws.length; return false; }
    }
    st.rankIdx += 3;
    return st.rankIdx < kws.length;
  },
};

// ── The end of a scan: issues, score, alerts, automation ──
async function gatherInput(env, st) {
  const db = env.DB;
  const pages = (await db.prepare(`SELECT path, status, in_sitemap, lastmod, data FROM seo_pages`).all()).results.map(p => ({ ...p, data: parse(p.data, {}) }));
  const keywords = await listKeywords(db);
  const since = new Date(Date.now() - 35 * 864e5).toISOString().slice(0, 10);
  const s = await getSeoSettings(db);
  const conn = await connections(env);
  const source = conn.rank.connected ? s.rank_provider : 'gsc';
  const ranks = {};
  for (const r of (await db.prepare(`SELECT date, keyword, page, position, clicks, impressions FROM seo_ranks WHERE source = ? AND device = 'all' AND date >= ?`).bind(source === 'gsc' ? 'gsc' : source, since).all()).results) (ranks[r.keyword] ||= []).push(r);
  // A licensed tracker stores per device: use mobile as "all".
  if (source !== 'gsc') for (const r of (await db.prepare(`SELECT date, keyword, page, position FROM seo_ranks WHERE source = ? AND device = 'mobile' AND date >= ?`).bind(source, since).all()).results) (ranks[r.keyword] ||= []).push(r);
  const day = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const pageGsc = {};
  const agg = async (from, to) => (await db.prepare(`SELECT value, SUM(clicks) AS c, SUM(impressions) AS i, SUM(position * impressions) AS pw FROM gsc_daily WHERE dim = 'page' AND date >= ? AND date < ? GROUP BY value`).bind(from, to).all().catch(() => ({ results: [] }))).results;
  const toPath = v => { try { return new URL(v).pathname; } catch { return v; } };
  for (const r of await agg(day(30), day(2))) pageGsc[toPath(r.value)] = { clicks28: r.c, impr28: r.i, ctr28: r.i ? r.c / r.i : 0, pos28: r.i ? r.pw / r.i : 0, prev28: 0 };
  for (const r of await agg(day(58), day(30))) { const p = toPath(r.value); (pageGsc[p] ||= { clicks28: 0, impr28: 0, ctr28: 0, pos28: 0 }).prev28 = r.c; }
  const tot = async (from, to) => (await db.prepare(`SELECT SUM(clicks) AS c, SUM(impressions) AS i FROM gsc_daily WHERE dim = 'total' AND date >= ? AND date < ?`).bind(from, to).first().catch(() => null)) || {};
  const [a, b] = [await tot(day(9), day(2)), await tot(day(16), day(9))];
  const totals = { clicks7: a.c || 0, impr7: a.i || 0, prev7: b.c || 0, prevImpr7: b.i || 0 };
  const speed = {};
  for (const r of (await db.prepare(`SELECT s.* FROM seo_speed s JOIN (SELECT path, strategy, MAX(date) AS d FROM seo_speed GROUP BY path, strategy) m ON m.path = s.path AND m.strategy = s.strategy AND m.d = s.date WHERE s.date >= ?`).bind(day(9)).all()).results) (speed[r.path] ||= {})[r.strategy] = r;
  const players = pages.filter(p => /^\/squad\/[^/]+\/$|^\/squad\/staff\/[^/]+\/$/.test(p.path) && p.data?.h1?.[0]).map(p => ({ name: p.data.h1[0].replace(/\s+/g, ' ').trim(), path: p.path }));
  const ranRecently = !!Object.values(ranks).flat().some(r => r.date >= day(6));
  return {
    pages, keywords, ranks, pageGsc, totals, speed, players,
    priv: st.priv, linkStatus: st.linkStatus, linkFrom: st.linkFrom, extStatus: st.extStatus, extFrom: st.ext, imgSize: st.imgSize,
    robots: st.robots, robotsOk: st.robotsOk, sitemap: st.sitemap || pages.filter(p => p.in_sitemap).map(p => ({ path: p.path })), sitemapAll: st.sitemapAll, stale: st.stale,
    // Orphans can only be judged when every page was read (not cut off at the page limit).
    complete: (st.queue || []).length < MAX_PAGES,
    inspections: st.inspections, sitemapGsc: st.sitemapGsc,
    ran: { crawl: !!st.ran?.crawl, gsc: !!st.ran?.gsc || ranRecently, index: !!st.ran?.index, speed: !!st.ran?.speed || Object.keys(speed).length > 0 },
  };
}

async function finishScan(env, scan, st) {
  const db = env.DB;
  const startedAt = scan.started_at, now = iso();
  if (!st.quick && st.ran?.crawl) await db.prepare(`DELETE FROM seo_pages WHERE scanned_at < ?`).bind(startedAt).run();
  const input = await gatherInput(env, st);
  if (st.quick) { input.ran = { crawl: true, gsc: false, index: false, speed: false }; input.stale = null; input.priv = {}; }
  let found = computeIssues(input);
  const quickPaths = st.quick ? new Set(st.queue) : null;
  if (quickPaths) found = found.filter(i => PAGE_TYPES.includes(i.type) && quickPaths.has(i.path));
  const before = new Map((await db.prepare(`SELECT id, status FROM seo_issues`).all()).results.map(r => [r.id, r.status]));
  const rows = found.map(i => ({ id: i.id, type: i.type, category: i.category, severity: i.severity, path: i.path, impact: i.impact, detail: JSON.stringify(i.detail) }));
  // One statement for all of them (Cloudflare counts every statement).
  if (rows.length) {
    await db.prepare(`INSERT INTO seo_issues (id, type, category, severity, path, detail, impact, status, first_seen, last_seen)
      SELECT json_extract(j.value, '$.id'), json_extract(j.value, '$.type'), json_extract(j.value, '$.category'), json_extract(j.value, '$.severity'), json_extract(j.value, '$.path'),
        json_extract(j.value, '$.detail'), json_extract(j.value, '$.impact'), 'open', ?1, ?1 FROM json_each(?2) j WHERE 1
      ON CONFLICT (id) DO UPDATE SET severity = excluded.severity, detail = excluded.detail, impact = excluded.impact, last_seen = excluded.last_seen,
        status = CASE WHEN seo_issues.status = 'fixed' THEN 'open' ELSE seo_issues.status END, fixed_at = CASE WHEN seo_issues.status = 'fixed' THEN NULL ELSE seo_issues.fixed_at END`)
      .bind(now, JSON.stringify(rows)).run();
  }
  // What was not found again is fixed (only for what this scan looked at).
  if (quickPaths) {
    await db.prepare(`UPDATE seo_issues SET status = 'fixed', fixed_at = ?1 WHERE status = 'open' AND last_seen < ?2 AND path IN (SELECT value FROM json_each(?3)) AND type IN (SELECT value FROM json_each(?4))`)
      .bind(now, startedAt, JSON.stringify([...quickPaths]), JSON.stringify(PAGE_TYPES)).run();
  } else {
    const cats = [input.ran.crawl && 'technical', input.ran.crawl && 'content', input.ran.crawl && 'offsite', input.ran.gsc && 'rankings', input.ran.index && 'indexing', input.ran.speed && 'speed'].filter(Boolean);
    await db.prepare(`UPDATE seo_issues SET status = 'fixed', fixed_at = ?1 WHERE status = 'open' AND last_seen < ?2 AND category IN (SELECT value FROM json_each(?3))`).bind(now, startedAt, JSON.stringify(cats)).run();
  }
  // Old fixed and ignored-and-gone issues are tidied after 90 days.
  await db.prepare(`DELETE FROM seo_issues WHERE status = 'fixed' AND fixed_at < ?`).bind(new Date(Date.now() - 90 * 864e5).toISOString()).run();
  const open = (await db.prepare(`SELECT id, type, severity, path, impact, detail FROM seo_issues WHERE status = 'open'`).all()).results;
  const score = healthScore(open), counts = countBySeverity(open);
  const fresh = found.filter(i => !before.has(i.id) || before.get(i.id) === 'fixed');
  const summary = { new: fresh.length, open: open.length, errors: (st.errors || []).slice(0, 12), ran: input.ran, quick: !!st.quick, paths: st.quick ? st.queue : undefined,
    byCategory: Object.fromEntries(CATEGORIES.map(c => [c.key, open.filter(i => info(i.type).category === c.key).length])) };
  if (!st.quick) {
    try { await sendAlerts(env, open, input); } catch (err) { console.error('[seo] alerts', err); }
  }
  // Automation rules (Phase 5): prepare or apply fixes for new issues of the types switched on.
  try { const { runRules } = await import('./seoFix.js'); summary.automation = await runRules(env, fresh); } catch (err) { console.error('[seo] rules', err); }
  return { score, counts, summary, pages: input.pages.length };
}

// ── Alerts (email + the admin bell), at most once a day for each kind ──
export const ALERT_KINDS = {
  deindexed: 'The website is disappearing from Google (impressions down over 40%)',
  robots_blocking: 'robots.txt is blocking Google',
  sitemap_errors: 'Google reports sitemap errors',
  homepage_error: 'The homepage answers with an error',
  private_indexable: 'A private page could appear on Google',
  noindex_public: 'An important page tells Google not to index it',
  cwv_poor: 'Core Web Vitals are poor',
  not_indexed_home: 'The homepage is not on Google',
};
export async function alertRecipients(env) {
  const s = await getSeoSettings(env.DB);
  return [...new Set([...superAdminEmails(env), ...String(s.alert_emails || '').split(/[\s,;]+/).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)).map(e => e.toLowerCase())])];
}
async function sendAlerts(env, open, input) {
  const db = env.DB, day = lagosDay();
  const hits = [];
  const has = t => open.filter(i => i.type === t);
  if (has('deindexed').length) hits.push(['deindexed', parse(has('deindexed')[0].detail, {}).problem]);
  if (has('robots_blocking').length) hits.push(['robots_blocking', 'robots.txt tells Google not to read the website.']);
  if (has('sitemap_errors').length) hits.push(['sitemap_errors', parse(has('sitemap_errors')[0].detail, {}).problem]);
  const home = open.find(i => i.type === 'http_error' && i.path === '/');
  if (home) hits.push(['homepage_error', parse(home.detail, {}).problem]);
  if (has('private_indexable').length) hits.push(['private_indexable', has('private_indexable').map(i => i.path).join(', ')]);
  const key = has('noindex_public').filter(i => ['/', '/news/', '/fixtures/', '/tickets/', '/shop/'].includes(i.path));
  if (key.length) hits.push(['noindex_public', key.map(i => i.path).join(', ')]);
  if (has('cwv_poor').length) hits.push(['cwv_poor', has('cwv_poor').map(i => parse(i.detail, {}).problem).join(' ')]);
  if (open.some(i => i.type === 'not_indexed' && i.path === '/')) hits.push(['not_indexed_home', 'Google Search Console says the homepage is not indexed.']);
  const to = await alertRecipients(env);
  for (const [kind, message] of hits) {
    const r = await db.prepare(`INSERT OR IGNORE INTO seo_alerts (kind, day, message, created_at) VALUES (?, ?, ?, ?)`).bind(kind, day, String(message || '').slice(0, 500), iso()).run();
    if (!r.meta?.changes || !to.length || !env.RESEND_API_KEY) continue;
    try {
      await sendEmail(env, { to, subject: `SEO alert: ${ALERT_KINDS[kind]}`, html: `<p><b>${ALERT_KINDS[kind]}</b></p><p>${escapeHtml(message)}</p><p>Open <a href="https://lobistarsfc.com/admin/seo/">Admin › SEO Scanner</a> for the details and how to fix it.</p><p style="color:#64748b;font-size:12px">You get this because you are a Super Admin${to.length > 3 ? ' or on the SEO alert list' : ''}. Once a day at most for each kind of problem.</p>` });
    } catch (err) { console.error('[seo] alert email', err); }
  }
  // Manual actions and security issues are not available through Google's API; Search Console emails its owners directly.
}
export const escapeHtml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── The timer (every minute, from /api/internal/health-check) ──
let settingsCache = { at: 0, s: null };
async function cachedSettings(db) {
  if (!settingsCache.s || Date.now() - settingsCache.at > 5 * 60e3) settingsCache = { at: Date.now(), s: await getSeoSettings(db) };
  return settingsCache.s;
}
export async function seoTick(env, origin) {
  const db = env.DB;
  await ensureSeoSchema(db);
  const busy = await activeScan(db);
  if (busy) { const r = await stepScan(env, origin, busy.id); return { more: !!r.scan && !r.scan.done && !r.busy, scan: r.scan }; }
  const s = await cachedSettings(db);
  const today = lagosDay();
  // Daily full scan at the chosen hour (03:00 Nigeria time by default).
  if (lagosHour() >= (Number(s.scan_hour) || 3) && s.last_full_day !== today) {
    await setSeoSetting(db, 'last_full_day', today); settingsCache.s = null;
    const r = await startScan(env, { kind: 'full', trigger: 'daily', by: 'Daily scan' });
    return { more: true, scan: r.scan };
  }
  // Weekly email report (Monday from 08:00).
  try { await maybeWeeklyReport(env, s); } catch (err) { console.error('[seo] weekly report', err); }
  // Pages due for a re-check after a fix (the site rebuilds first, about 3 minutes).
  const queue = parse(s.quick_queue, []);
  const due = queue.filter(q => Date.parse(q.after) <= Date.now());
  if (due.length) {
    await setSeoSetting(db, 'quick_queue', JSON.stringify(queue.filter(q => !due.includes(q)))); settingsCache.s = null;
    const r = await startScan(env, { kind: 'quick', trigger: 'after_fix', by: 'Check after a fix', paths: due.map(q => q.path) });
    if (!r.error) return { more: true, scan: r.scan };
  }
  // New or changed pages in sitemap.xml (a story published): checked every 10 minutes.
  if (!s.sitemap_checked_at || Date.now() - Date.parse(s.sitemap_checked_at) > 10 * 60e3) {
    await setSeoSetting(db, 'sitemap_checked_at', iso()); settingsCache.s = null;
    const f = await politeFetch(`${origin}/sitemap.xml`);
    if (f.res?.ok) {
      const xml = await f.res.text();
      const sig = `${xml.length}:${[...xml].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)}`;
      if (sig !== s.sitemap_sig) {
        await setSeoSetting(db, 'sitemap_sig', sig);
        const known = new Map((await db.prepare(`SELECT path, lastmod FROM seo_pages`).all()).results.map(r => [r.path, r.lastmod]));
        const changed = parseSitemap(xml).filter(x => known.size && (!known.has(x.path) || (x.lastmod && x.lastmod !== known.get(x.path)))).map(x => x.path);
        if (changed.length) {
          const r = await startScan(env, { kind: 'quick', trigger: 'published', by: 'New or changed page', paths: changed });
          if (!r.error) return { more: true, scan: r.scan };
        }
      }
    } else await drain(f.res);
  }
  return { more: false };
}
/** Adds pages to re-check after a fix (in about `minutes` minutes, once the site has rebuilt). */
export async function queueRecheck(db, paths, minutes = 4) {
  const s = await getSeoSettings(db);
  const q = parse(s.quick_queue, []);
  const after = new Date(Date.now() + minutes * 60e3).toISOString();
  for (const p of paths) if (p && !q.some(x => x.path === p)) q.push({ path: p, after });
  await setSeoSetting(db, 'quick_queue', JSON.stringify(q.slice(-20)));
  settingsCache.s = null;
}

// ── Weekly email report ──
async function maybeWeeklyReport(env, s) {
  if (s.weekly_report !== '1') return;
  const t = Date.now() + 3600e3, d = new Date(t);
  if (d.getUTCDay() !== 1 || d.getUTCHours() < 8) return;
  const week = lagosDay();
  if (s.weekly_sent === week) return;
  await setSeoSetting(env.DB, 'weekly_sent', week); settingsCache.s = null;
  const to = await alertRecipients(env);
  if (!to.length || !env.RESEND_API_KEY) return;
  const { reportData, reportHtml } = await import('./seoReport.js');
  const data = await reportData(env);
  await sendEmail(env, { to, subject: `SEO weekly report: score ${data.score ?? '–'}/100${data.change ? ` (${data.change > 0 ? '+' : ''}${data.change})` : ''}`, html: reportHtml(data) });
}
export { fetchFollow, seoFake };
