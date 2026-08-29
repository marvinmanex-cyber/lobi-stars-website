import { requireAdmin } from '../_lib/adminEvents.js';

// GET /api/admin/analytics?days=7|30|90 -- aggregate visitor stats for the
// /admin/analytics dashboard. Auth: x-admin-code header must match ADMIN_CODE.
export async function onRequestGet({ request, env }) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;

  let days = parseInt(new URL(request.url).searchParams.get('days'), 10);
  if (![7, 30, 90].includes(days)) days = 30;
  const since = `-${days} days`;
  const db = env.DB;

  try {
    await db.prepare(`SELECT 1 FROM pageviews LIMIT 1`).first();
  } catch {
    return Response.json(
      { error: 'No analytics table yet. Run the pageviews CREATE TABLE from schema.sql on the database.' },
      { status: 503 }
    );
  }

  const q = sql => db.prepare(sql).bind(since);

  const [totals, today, daily, topPages, referrers, countries, devices, newReturning] = await Promise.all([
    q(`SELECT COUNT(*) AS views,
              COUNT(DISTINCT visitor_id) AS visitors,
              COUNT(DISTINCT session_id) AS sessions
       FROM pageviews WHERE ts >= datetime('now', ?)`).first(),

    db.prepare(
      `SELECT COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors
       FROM pageviews WHERE ts >= datetime('now', 'start of day')`
    ).first(),

    q(`SELECT substr(ts, 1, 10) AS day,
              COUNT(*) AS views,
              COUNT(DISTINCT visitor_id) AS visitors
       FROM pageviews WHERE ts >= datetime('now', ?)
       GROUP BY day ORDER BY day`).all(),

    q(`SELECT path,
              COUNT(*) AS views,
              COUNT(DISTINCT visitor_id) AS visitors
       FROM pageviews WHERE ts >= datetime('now', ?)
       GROUP BY path ORDER BY views DESC LIMIT 20`).all(),

    q(`SELECT COALESCE(NULLIF(referrer_host, ''), '(direct / app)') AS host,
              COUNT(*) AS views
       FROM pageviews WHERE ts >= datetime('now', ?)
       GROUP BY host ORDER BY views DESC LIMIT 15`).all(),

    q(`SELECT COALESCE(NULLIF(country, ''), '??') AS country,
              COUNT(*) AS views,
              COUNT(DISTINCT visitor_id) AS visitors
       FROM pageviews WHERE ts >= datetime('now', ?)
       GROUP BY country ORDER BY views DESC LIMIT 20`).all(),

    q(`SELECT COALESCE(NULLIF(device, ''), 'unknown') AS device,
              COUNT(*) AS views
       FROM pageviews WHERE ts >= datetime('now', ?)
       GROUP BY device ORDER BY views DESC`).all(),

    q(`SELECT SUM(CASE WHEN is_new_visitor = 1 THEN 1 ELSE 0 END) AS new_views,
              SUM(CASE WHEN is_new_visitor = 0 THEN 1 ELSE 0 END) AS returning_views
       FROM pageviews WHERE ts >= datetime('now', ?)`).first(),
  ]);

  return Response.json({
    days,
    totals,
    today,
    daily: daily.results,
    topPages: topPages.results,
    referrers: referrers.results,
    countries: countries.results,
    devices: devices.results,
    newReturning,
  });
}
