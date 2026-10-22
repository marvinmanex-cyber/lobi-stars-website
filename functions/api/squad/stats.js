import { seasonStats } from '../_lib/stats.js';

// GET /api/squad/stats?player=<slug> -- one player's numbers for the current
// season, worked out from the match data entered in Live Match Control
// (appearances, starts, goals, assists, clean sheets for goalkeepers, minutes,
// yellow and red cards, Man of the Match awards). Used by the "2026/27" tab on
// the player profile pages. Cached for 5 minutes.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const slug = String(url.searchParams.get('player') || '').slice(0, 80);
  let roster = [], site = {};
  try { roster = await (await env.ASSETS.fetch(new URL('/data/players.json', url))).json(); } catch {}
  try { site = await (await env.ASSETS.fetch(new URL('/data/site.json', url))).json(); } catch {}
  const startMonth = /^\d{4}-(\d{2})-\d{2}$/.test(site.seasonStart || '') ? Number(site.seasonStart.slice(5, 7)) : 8;
  const empty = { apps: 0, starts: 0, goals: 0, assists: 0, yellow: 0, red: 0, cleanSheets: 0, minutes: 0, motm: 0 };
  try {
    const data = await seasonStats(env.DB, roster, { season: url.searchParams.get('season') || '', currentSeason: site.currentSeason, startMonth });
    return Response.json({ season: data.season, matches: data.played, stats: { ...empty, ...(data.players?.[slug] || {}) } }, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch (err) {
    console.error('[squad stats]', err);
    return Response.json({ season: site.currentSeason || '', matches: 0, stats: empty }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  }
}
