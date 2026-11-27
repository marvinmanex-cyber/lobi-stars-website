import { publicHub } from '../_lib/statsPro.js';
import { seasonOf } from '../_lib/stats.js';

// GET /api/stats/hub.json[?season=2026/27] -- data for the public stats hub (/stats/hub/): season leaders, all-time
// leaders, club records, head-to-head against every club, player totals for the comparison tool and recent milestones.
// Published Statistics Center matches only; no notes, ratings notes, analyses or staff names; youth players unnamed
// unless the club allowed it.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  let site = {};
  try { site = await (await env.ASSETS.fetch(new URL('/data/site.json', url))).json(); } catch { /* defaults */ }
  const startMonth = /^\d{4}-(\d{2})-\d{2}$/.test(site.seasonStart || '') ? Number(site.seasonStart.slice(5, 7)) : 8;
  const season = /^\d{4}\/\d{2}$/.test(url.searchParams.get('season') || '') ? url.searchParams.get('season') : site.currentSeason || seasonOf(new Date().toISOString(), startMonth);
  try {
    return Response.json(await publicHub(env.DB, season), { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch (err) {
    console.error('[stats hub]', err);
    return Response.json({ error: 'The statistics are not available right now.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
