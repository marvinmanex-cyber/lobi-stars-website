import { requireAdminUser } from '../_lib/adminEvents.js';
import { ensureAnalyticsSchema } from '../_lib/analytics.js';
import { ensureContactsSchema, SOURCES } from '../_lib/contacts.js';
import { ensureTable as ensureMatchTables, isHomeGame } from '../_lib/matchCentre.js';
import { matchSlug } from '../_lib/matchSlug.js';
import { resolveRange, sqlTs, isoTs } from '../_lib/reportRange.js';
import { broadcastStats } from '../_lib/commentary.js';

// GET /api/admin/analytics?range=today|7d|30d|season|custom&from=&to=
// Everything the admin dashboard shows. No full contact details are
// returned here (only names + source for recent sign-ups).
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureAnalyticsSchema(db);
  await ensureContactsSchema(db);
  await ensureMatchTables(db);

  const url = new URL(request.url);
  let seasonStart = '';
  try { seasonStart = (await (await env.ASSETS.fetch(new URL('/data/site.json', url))).json()).seasonStart || ''; } catch {}
  const r = resolveRange(url, seasonStart);
  const S = [sqlTs(r.start), sqlTs(r.end)], P = [sqlTs(r.prevStart), sqlTs(r.prevEnd)];
  const SI = [isoTs(r.start), isoTs(r.end)], PI = [isoTs(r.prevStart), isoTs(r.prevEnd)];
  const one = async (sql, binds) => (await db.prepare(sql).bind(...binds).first()) || {};
  const all = async (sql, binds = []) => (await db.prepare(sql).bind(...binds).all()).results;
  const tableExists = async n => !!(await db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).bind(n).first());
  const visitorKey = `COALESCE(NULLIF(visitor_id, ''), visitor_hash)`;

  const pvSql = `SELECT COUNT(*) AS views, COUNT(DISTINCT CASE WHEN consent = 1 THEN ${visitorKey} END) AS visitors
                 FROM pageviews WHERE ts >= ? AND ts < ?`;
  const [pvNow, pvPrev] = await Promise.all([one(pvSql, S), one(pvSql, P)]);
  const dlSql = `SELECT COUNT(*) AS n FROM track_events WHERE name IN ('programme_download', 'brochure_download') AND ts >= ? AND ts < ?`;
  const [dlNow, dlPrev] = await Promise.all([one(dlSql, S), one(dlSql, P)]);
  const enqSql = `SELECT COUNT(*) AS n FROM enquiries WHERE created_at >= ? AND created_at < ?`;
  const [enqNow, enqPrev] = await Promise.all([one(enqSql, SI), one(enqSql, PI)]);
  const [totalNow, totalPrev] = await Promise.all([
    one(`SELECT COUNT(*) AS n FROM contacts WHERE first_seen < ?`, [SI[1]]),
    one(`SELECT COUNT(*) AS n FROM contacts WHERE first_seen < ?`, [PI[1]]),
  ]);
  const newSql = `SELECT COUNT(*) AS n FROM contacts WHERE first_seen >= ? AND first_seen < ?`;
  const [newNow, newPrev] = await Promise.all([one(newSql, SI), one(newSql, PI)]);

  const kpi = (now, prev) => ({ value: now || 0, previous: prev || 0 });

  // Source breakdown (all contacts) + first-touch.
  const totalContacts = (await one(`SELECT COUNT(*) AS n FROM contacts`, [])).n || 0;
  const bySource = await all(`SELECT source, COUNT(DISTINCT contact_id) AS n FROM contact_sources GROUP BY source`);
  const firstTouch = await all(`SELECT first_source AS source, COUNT(*) AS n FROM contacts GROUP BY first_source`);
  const sources = Object.entries(SOURCES).map(([key, label]) => {
    const n = bySource.find(x => x.source === key)?.n || 0;
    return { key, label, contacts: n, pct: totalContacts ? Math.round((n / totalContacts) * 1000) / 10 : 0 };
  });

  // Charts
  const daily = await all(
    `SELECT date(ts, '+1 hour') AS day, COUNT(*) AS views, COUNT(DISTINCT CASE WHEN consent = 1 THEN ${visitorKey} END) AS visitors
     FROM pageviews WHERE ts >= ? AND ts < ? GROUP BY day ORDER BY day`, S);
  const refRows = await all(
    `SELECT LOWER(COALESCE(NULLIF(utm_source, ''), NULLIF(referrer_host, ''), '')) AS src, COUNT(*) AS views
     FROM pageviews WHERE ts >= ? AND ts < ? GROUP BY src`, S);
  const traffic = { WhatsApp: 0, Facebook: 0, Instagram: 0, X: 0, Google: 0, Direct: 0, Other: 0 };
  for (const row of refRows) traffic[classifySource(row.src)] += row.views;
  const devices = await all(`SELECT COALESCE(device, 'unknown') AS device, COUNT(*) AS views FROM pageviews WHERE ts >= ? AND ts < ? GROUP BY device ORDER BY views DESC`, S);

  // Tables
  const topPages = await all(
    `SELECT path, COUNT(*) AS views, COUNT(DISTINCT CASE WHEN consent = 1 THEN ${visitorKey} END) AS visitors
     FROM pageviews WHERE ts >= ? AND ts < ? GROUP BY path ORDER BY views DESC LIMIT 10`, S);
  const locations = await all(
    `SELECT COALESCE(NULLIF(region, ''), '(unknown)') AS region, COALESCE(country, '') AS country, COUNT(*) AS views
     FROM pageviews WHERE ts >= ? AND ts < ? GROUP BY region, country ORDER BY views DESC LIMIT 10`, S);
  const recent = await all(`SELECT first_name, surname, first_source, first_seen FROM contacts ORDER BY first_seen DESC LIMIT 10`);
  const recentSignups = recent.map(c => ({
    name: [c.first_name, c.surname ? `${c.surname[0]}.` : ''].filter(Boolean).join(' ') || '(no name)',
    source: SOURCES[c.first_source] || c.first_source, at: c.first_seen,
  }));

  // Matchday panel: recent Lobi Stars home games.
  const { results: games } = await db.prepare(`SELECT * FROM events WHERE active = 1 ORDER BY event_date DESC LIMIT 30`).all();
  const homeGames = games.filter(isHomeGame).slice(0, 10);
  const hasVotes = await tableExists('motm_votes');
  const hasPredictions = await tableExists('predictions');
  const matchday = [];
  for (const g of homeGames) {
    const slug = matchSlug(g);
    const live = await one(`SELECT COUNT(DISTINCT CASE WHEN consent = 1 THEN ${visitorKey} END) AS viewers, COUNT(*) AS views FROM pageviews WHERE path IN (?, ?)`,
      [`/matches/${slug}/live`, `/matches/${slug}/live/`]);
    const ev = await all(`SELECT name, COUNT(*) AS n FROM track_events WHERE label = ? AND name IN ('watch_play', 'commentary_click') GROUP BY name`, [slug]);
    matchday.push({
      id: g.id, slug, match: `${g.home_team} vs ${g.away_team}`, date: g.event_date,
      votes: hasVotes ? (await one(`SELECT COUNT(*) AS n FROM motm_votes WHERE event_id = ?`, [g.id])).n || 0 : 0,
      predictions: hasPredictions ? (await one(`SELECT COUNT(*) AS n FROM predictions WHERE event_id = ?`, [g.id])).n || 0 : 0,
      liveViewers: live.viewers || 0, liveViews: live.views || 0,
      watchPlays: ev.find(x => x.name === 'watch_play')?.n || 0,
      commentaryClicks: ev.find(x => x.name === 'commentary_click')?.n || 0,
    });
  }

  // Partners panel
  let partnerList = [];
  try { partnerList = await (await env.ASSETS.fetch(new URL('/data/partners.json', url))).json(); } catch {}
  const clicks = await all(`SELECT label, COUNT(*) AS n FROM track_events WHERE name = 'partner_click' AND ts >= ? AND ts < ? GROUP BY label`, S);
  const partners = partnerList.map(p => ({ slug: p.slug, name: p.name, tier: p.tier, clicks: clicks.find(c => c.label === p.slug)?.n || 0 }));

  // Lobi Stars FC Live: listening figures per match in this period.
  const broadcast = await broadcastStats(db, SI[0], SI[1]);

  const evCounts = await all(`SELECT name, COUNT(*) AS n FROM track_events WHERE ts >= ? AND ts < ? GROUP BY name`, S);

  return Response.json({
    range: r,
    kpis: {
      pageViews: kpi(pvNow.views, pvPrev.views),
      uniqueVisitors: kpi(pvNow.visitors, pvPrev.visitors),
      downloads: kpi(dlNow.n, dlPrev.n),
      enquiries: kpi(enqNow.n, enqPrev.n),
      totalContacts: kpi(totalNow.n, totalPrev.n),
      newContacts: kpi(newNow.n, newPrev.n),
    },
    totalContacts, sources,
    firstTouch: firstTouch.map(f => ({ source: SOURCES[f.source] || f.source || 'Unknown', contacts: f.n })),
    daily, traffic, devices, topPages, locations, recentSignups, matchday,
    partners, partnerImpressions: pvNow.views || 0, broadcast,
    events: Object.fromEntries(evCounts.map(e => [e.name, e.n])),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export function classifySource(src) {
  if (!src) return 'Direct';
  if (/whatsapp|wa\.me|^l\.wl\.co/.test(src)) return 'WhatsApp';
  if (/facebook|^fb\b|fb\.com|fb\.me/.test(src)) return 'Facebook';
  if (/instagram|^ig\b/.test(src)) return 'Instagram';
  if (/(^|\.)t\.co$|twitter|(^|\.)x\.com$|^x$/.test(src)) return 'X';
  if (/google/.test(src)) return 'Google';
  return 'Other';
}
