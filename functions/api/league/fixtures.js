import { leagueFrom, filterFixtures, json, badRequest } from '../_lib/leagueApi.js';
import { fixtureJson } from '../_lib/leagueDb.js';

// GET /api/league/fixtures?competition=&team=&matchday=&status=&venue=&from=&to=&ha=
// Published fixtures in kick-off order. team is a code or slug ('lobi' for
// Lobi Stars); ha (home|away) is relative to that team. Postponed fixtures keep
// their place and carry originalKickoff and the reason.
const ALLOWED = ['competition', 'team', 'matchday', 'status', 'venue', 'from', 'to', 'ha'];
export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    for (const k of url.searchParams.keys()) if (!ALLOWED.includes(k)) return badRequest(`Unknown parameter: ${k}.`);
    const { league, error } = await leagueFrom(env, url);
    if (error) return error;
    const r = filterFixtures(league, url);
    if (r.error) return badRequest(r.error);
    return json({ competition: league.competition.slug, fixtures: r.list.map(f => fixtureJson(f, url.origin)), serverTime: new Date().toISOString() });
  } catch (err) {
    console.error('[league] fixtures', err);
    return json({ error: 'Could not load the fixtures.' }, 500);
  }
}
