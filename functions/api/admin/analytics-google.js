import { requireAdminUser } from '../_lib/adminEvents.js';
import { ensureAnalyticsSchema } from '../_lib/analytics.js';
import { ensureAnalyticsSyncSchema, syncStatus, KEY_EVENTS } from '../_lib/analyticsSync.js';
import { resolveRange, sqlTs } from '../_lib/reportRange.js';

// GET /api/admin/analytics-google?range=today|7d|30d|season|custom&from=&to=
// Admin › Analytics › Google & Search (permission analytics.view_all): the
// Search Console and GA4 figures copied by the daily sync, side by side with the
// website's own counting, for the same period and the period before.
// Only totals: nothing here identifies a person.
const WAT = 3600e3, DAY = 864e5;
const ymd = ms => new Date(ms + WAT).toISOString().slice(0, 10);
const SITE = /^https?:\/\/(www\.)?lobistarsfc\.com/i;
const pathOf = url => { const p = String(url || '').replace(SITE, '') || '/'; return p.split('?')[0].split('#')[0] || '/'; };
const norm = p => (p.length > 1 && !p.endsWith('/') && !/\.[a-z0-9]+$/i.test(p) ? p + '/' : p);
const round = (n, d = 1) => Math.round((Number(n) || 0) * 10 ** d) / 10 ** d;

export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  await Promise.all([ensureAnalyticsSyncSchema(db), ensureAnalyticsSchema(db)]);
  const url = new URL(request.url);
  let seasonStart = '';
  try { seasonStart = (await (await env.ASSETS.fetch(new URL('/data/site.json', url))).json()).seasonStart || ''; } catch {}
  const r = resolveRange(url, seasonStart);
  const D = [ymd(r.start), ymd(r.end - DAY)], PD = [ymd(r.prevStart), ymd(r.prevEnd - DAY)];
  const one = async (sql, b) => (await db.prepare(sql).bind(...b).first()) || {};
  const all = async (sql, b = []) => (await db.prepare(sql).bind(...b).all()).results;

  // ── Search Console ──
  const gscKpiSql = `SELECT SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) AS posw
                     FROM gsc_daily WHERE dim = 'total' AND date >= ? AND date <= ?`;
  const [gNow, gPrev] = await Promise.all([one(gscKpiSql, D), one(gscKpiSql, PD)]);
  const gk = g => ({ clicks: g.clicks || 0, impressions: g.impressions || 0, ctr: g.impressions ? round((g.clicks / g.impressions) * 100, 2) : 0, position: g.impressions ? round(g.posw / g.impressions) : 0 });
  const gscDim = (dim, limit) => all(
    `SELECT value, SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) / MAX(SUM(impressions), 1) AS position
     FROM gsc_daily WHERE dim = ? AND date >= ? AND date <= ? GROUP BY value ORDER BY clicks DESC, impressions DESC LIMIT ${limit}`, [dim, ...D]);
  const [queries, gscPages, countries, gscDevices, gscDaily] = await Promise.all([
    gscDim('query', 20), gscDim('page', 200), gscDim('country', 10), gscDim('device', 5),
    all(`SELECT date, clicks, impressions FROM gsc_daily WHERE dim = 'total' AND date >= ? AND date <= ? ORDER BY date`, D),
  ]);
  const withCtr = x => ({ ...x, ctr: x.impressions ? round((x.clicks / x.impressions) * 100, 2) : 0, position: round(x.position) });

  // ── GA4 ──
  const ga4KpiSql = `SELECT SUM(sessions) AS sessions, SUM(users) AS users, SUM(engagement_rate * sessions) AS engw, SUM(avg_session_duration * sessions) AS durw
                     FROM ga4_daily WHERE date >= ? AND date <= ?`;
  const [aNow, aPrev] = await Promise.all([one(ga4KpiSql, D), one(ga4KpiSql, PD)]);
  const ak = a => ({ sessions: a.sessions || 0, users: a.users || 0, engagement: a.sessions ? round((a.engw / a.sessions) * 100) : 0, duration: a.sessions ? Math.round(a.durw / a.sessions) : 0 });
  const [channels, ga4Pages, ga4Devices, ga4Daily, evNow, evPrev] = await Promise.all([
    all(`SELECT channel, SUM(sessions) AS sessions, SUM(users) AS users FROM ga4_daily WHERE date >= ? AND date <= ? GROUP BY channel ORDER BY sessions DESC LIMIT 12`, D),
    all(`SELECT page_path AS path, SUM(sessions) AS sessions, SUM(engagement_rate * sessions) / MAX(SUM(sessions), 1) AS engagement FROM ga4_daily WHERE date >= ? AND date <= ? GROUP BY page_path ORDER BY sessions DESC LIMIT 200`, D),
    all(`SELECT device, SUM(sessions) AS sessions FROM ga4_daily WHERE date >= ? AND date <= ? GROUP BY device ORDER BY sessions DESC`, D),
    all(`SELECT date, SUM(sessions) AS sessions FROM ga4_daily WHERE date >= ? AND date <= ? GROUP BY date ORDER BY date`, D),
    all(`SELECT event_name, SUM(event_count) AS n FROM ga4_events_daily WHERE date >= ? AND date <= ? GROUP BY event_name`, D),
    all(`SELECT event_name, SUM(event_count) AS n FROM ga4_events_daily WHERE date >= ? AND date <= ? GROUP BY event_name`, PD),
  ]);
  const evMap = rows => Object.fromEntries(rows.map(e => [e.event_name, e.n]));
  const en = evMap(evNow), ep = evMap(evPrev);
  const events = KEY_EVENTS.filter(e => e !== 'page_view').map(name => ({ name, value: en[name] || 0, previous: ep[name] || 0 }));

  // ── The website's own counting (same period) ──
  const own = await all(
    `SELECT date(ts, '+1 hour') AS date, COUNT(*) AS views FROM pageviews WHERE ts >= ? AND ts < ? GROUP BY date ORDER BY date`, [sqlTs(r.start), sqlTs(r.end)]);
  const ownPages = await all(`SELECT path, COUNT(*) AS views FROM pageviews WHERE ts >= ? AND ts < ? GROUP BY path ORDER BY views DESC LIMIT 200`, [sqlTs(r.start), sqlTs(r.end)]);

  // ── Merged: one row per page (search, GA4 sessions, own page views) ──
  const pages = new Map();
  const row = p => { const k = norm(p); if (!pages.has(k)) pages.set(k, { path: k, views: 0, sessions: 0, clicks: 0, impressions: 0, posw: 0 }); return pages.get(k); };
  for (const x of ownPages) row(x.path).views += x.views;
  for (const x of ga4Pages) row(x.path).sessions += x.sessions;
  for (const x of gscPages) { const p = row(pathOf(x.value)); p.clicks += x.clicks; p.impressions += x.impressions; p.posw += x.position * x.impressions; }
  const merged = [...pages.values()]
    .map(p => ({ path: p.path, views: p.views, sessions: p.sessions, clicks: p.clicks, impressions: p.impressions, ctr: p.impressions ? round((p.clicks / p.impressions) * 100, 2) : 0, position: p.impressions ? round(p.posw / p.impressions) : null }))
    .sort((a, b) => (b.views + b.sessions + b.clicks * 5) - (a.views + a.sessions + a.clicks * 5)).slice(0, 25);

  // One date axis for the combined chart.
  const days = [];
  for (let d = D[0]; d <= D[1]; d = new Date(Date.parse(d + 'T00:00:00Z') + DAY).toISOString().slice(0, 10)) days.push(d);
  const pick = (rows, key) => { const m = Object.fromEntries(rows.map(x => [x.date, x[key]])); return days.map(d => m[d] ?? null); };

  const status = await syncStatus(env);
  return Response.json({
    range: r,
    status: { config: status.config, lastSuccess: status.lastSuccess, lastError: status.lastError, run: status.run, gscLatest: status.counts.gscLatest, ga4Latest: status.counts.ga4Latest, hasData: !!(status.counts.gsc || status.counts.ga4) },
    gsc: { now: gk(gNow), prev: gk(gPrev), queries: queries.map(withCtr), countries: countries.map(withCtr), devices: gscDevices.map(withCtr) },
    ga4: { now: ak(aNow), prev: ak(aPrev), channels, devices: ga4Devices, events },
    daily: { days, views: pick(own, 'views'), sessions: pick(ga4Daily, 'sessions'), clicks: pick(gscDaily, 'clicks'), impressions: pick(gscDaily, 'impressions') },
    pages: merged,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
