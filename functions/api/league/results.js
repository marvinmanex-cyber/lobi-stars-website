import { leagueFrom, filterFixtures, json, badRequest } from '../_lib/leagueApi.js';
import { fixtureJson } from '../_lib/leagueDb.js';

// GET /api/league/results?competition=&team=&matchday= -- finished and
// awarded matches, newest first.
export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    for (const k of url.searchParams.keys()) if (!['competition', 'team', 'matchday'].includes(k)) return badRequest(`Unknown parameter: ${k}.`);
    const { league, error } = await leagueFrom(env, url);
    if (error) return error;
    const r = filterFixtures(league, url);
    if (r.error) return badRequest(r.error);
    const done = r.list.filter(f => ['full_time', 'awarded'].includes(f.status) && Number.isInteger(f.home_goals) && Number.isInteger(f.away_goals)).reverse();
    return json({ competition: league.competition.slug, results: done.map(f => fixtureJson(f, url.origin)) });
  } catch (err) {
    console.error('[league] results', err);
    return json({ error: 'Could not load the results.' }, 500);
  }
}
