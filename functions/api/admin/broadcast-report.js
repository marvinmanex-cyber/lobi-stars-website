import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { broadcastStats } from '../_lib/commentary.js';
import { resolveRange } from '../_lib/reportRange.js';
import { buildCsv } from '../_lib/xlsx.js';
import { watDate, watTime } from '../_lib/fanQuery.js';

// GET /api/admin/broadcast-report?range=... -- internal Lobi Stars FC Live
// "Broadcast Report" CSV: listens, unique listeners, average listening time
// and peak concurrent listeners per match.
export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const url = new URL(request.url);
  let seasonStart = '';
  try { seasonStart = (await (await env.ASSETS.fetch(new URL('/data/site.json', url))).json()).seasonStart || ''; } catch {}
  const r = resolveRange(url, seasonStart);
  const rows = await broadcastStats(env.DB, new Date(r.start).toISOString(), new Date(r.end).toISOString());
  await logAdminAction(env.DB, admin, 'export_broadcast_report', r.label);
  const csv = buildCsv(
    ['Match', 'Kick-off (WAT)', 'Listens (plays)', 'Unique listeners', 'Average listening time (minutes)', 'Peak concurrent listeners', 'Peak time (WAT)', 'Player errors'],
    rows.map(m => [m.match, watTime(m.date), m.listens, m.uniqueListeners, m.avgMinutes, m.peak, watTime(m.peakAt), m.errors])
      .concat([[], [`Period: ${r.label} (Nigerian time). Lobi Stars FC Live.`]]),
  );
  return new Response(csv, { headers: {
    'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="lobi-stars-fc-live-broadcast-report-${watDate()}.csv"`,
  } });
}
