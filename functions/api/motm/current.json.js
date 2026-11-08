// GET /api/motm/current.json[?match=<id or slug>] -- Man of the Match status for the current home
// game (or the one asked for): status (upcoming | open | closed | cancelled | not_home | no_match),
// opensAt, closesAt, matchId, opponent, sponsor; candidates while open; the announcement once
// closed (counted and saved automatically on the first request at or after closing time).
// Also: the signed-in fan's own vote, and this season's past winners. Never cached.
import { motmStatus, seasonArchive, getSponsor } from '../_lib/motmService.js';
import { sponsorView } from '../_lib/motmRules.js';

export async function onRequestGet({ request, env }) {
  const key = new URL(request.url).searchParams.get('match') || '';
  const s = await motmStatus(env, request, key);
  const archive = await seasonArchive(env, { sponsor: sponsorView(await getSponsor(env.DB)) });
  return Response.json({ ...s, archive, serverTime: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
}
