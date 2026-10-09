import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { ensureAnalyticsSchema } from '../_lib/analytics.js';
import { resolveRange, sqlTs } from '../_lib/reportRange.js';
import { buildCsv } from '../_lib/xlsx.js';
import { watDate } from '../_lib/fanQuery.js';

// GET /api/admin/partner-report?range=... -- CSV for sponsors:
// partner, tier, impressions, clicks, click rate.
// Impressions = page views in the period, because every page's footer shows
// every partner's logo.
export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  await ensureAnalyticsSchema(env.DB);
  const url = new URL(request.url);
  let seasonStart = '', partners = [];
  try { seasonStart = (await (await env.ASSETS.fetch(new URL('/data/site.json', url))).json()).seasonStart || ''; } catch {}
  try { partners = await (await env.ASSETS.fetch(new URL('/data/partners.json', url))).json(); } catch {}
  const r = resolveRange(url, seasonStart);
  const S = [sqlTs(r.start), sqlTs(r.end)];
  const impressions = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM pageviews WHERE ts >= ? AND ts < ?`).bind(...S).first()).n || 0;
  const { results: clicks } = await env.DB.prepare(
    `SELECT label, COUNT(*) AS n FROM track_events WHERE name = 'partner_click' AND ts >= ? AND ts < ? GROUP BY label`
  ).bind(...S).all();
  const rows = partners.map(p => {
    const c = clicks.find(x => x.label === p.slug)?.n || 0;
    return [p.name, p.tier, impressions, c, impressions ? `${((c / impressions) * 100).toFixed(2)}%` : '0.00%'];
  });
  await logAdminAction(env.DB, admin, 'partner_report', r.label);
  const csv = buildCsv(['Partner', 'Tier', 'Impressions', 'Clicks', 'Click Rate'], [...rows, [], [`Period: ${r.label} (Nigerian time)`]]);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="lobi-stars-partner-report-${watDate()}.csv"`,
    },
  });
}
