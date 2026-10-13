import { leagueFrom, overviewPayload, json } from '../_lib/leagueApi.js';

// GET /api/league/overview?competition= -- the competition, its rules and
// clubs, matchday progress, Lobi Stars' next match and last result.
export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const { league, error } = await leagueFrom(env, url);
    if (error) return error;
    return json(overviewPayload(league, url.origin));
  } catch (err) {
    console.error('[league] overview', err);
    return json({ error: 'Could not load the league.' }, 500);
  }
}
