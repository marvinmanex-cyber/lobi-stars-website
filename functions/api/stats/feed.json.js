import { publicFeed } from '../_lib/statsExtras.js';
import { seasonOf } from '../_lib/stats.js';

// GET /api/stats/feed.json[?season=2026/27] -- the club's published match statistics as open data (JSON) for media
// partners and apps: record, form, top scorers and assists, and each published match's score and team stats.
// Published matches only; never ratings, notes, analysis, line-up details or staff names. Free to use with credit.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  let site = {};
  try { site = await (await env.ASSETS.fetch(new URL('/data/site.json', url))).json(); } catch { /* defaults */ }
  const startMonth = /^\d{4}-(\d{2})-\d{2}$/.test(site.seasonStart || '') ? Number(site.seasonStart.slice(5, 7)) : 8;
  const season = /^\d{4}\/\d{2}$/.test(url.searchParams.get('season') || '') ? url.searchParams.get('season') : site.currentSeason || seasonOf(new Date().toISOString(), startMonth);
  try {
    return Response.json(await publicFeed(env.DB, season), { headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' } });
  } catch (err) {
    console.error('[stats feed]', err);
    return Response.json({ error: 'The feed is not available right now.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
