import { leagueFrom, tablePayload, json, badRequest } from '../_lib/leagueApi.js';

// GET /api/league/table?competition=&scope=overall|home|away&upto=<matchday>
// The table worked out from the results, adjustments and rules.
export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    for (const k of url.searchParams.keys()) if (!['competition', 'scope', 'upto'].includes(k)) return badRequest(`Unknown parameter: ${k}.`);
    const scope = url.searchParams.get('scope') || 'overall';
    if (!['overall', 'home', 'away'].includes(scope)) return badRequest('scope must be overall, home or away.');
    const u = url.searchParams.get('upto');
    const upTo = u === null || u === '' ? null : Number(u);
    if (upTo !== null && !(Number.isInteger(upTo) && upTo >= 1 && upTo <= 60)) return badRequest('upto must be a matchday number.');
    const { league, error } = await leagueFrom(env, url);
    if (error) return error;
    if (!league.competition.has_table) return badRequest('This competition has no table.');
    return json(tablePayload(league, { scope, upTo }));
  } catch (err) {
    console.error('[league] table', err);
    return json({ error: 'Could not load the table.' }, 500);
  }
}
