import { leagueFrom, findTeam, badRequest } from '../_lib/leagueApi.js';
import { buildIcs } from '../_lib/league/ics.js';

// GET /api/league/calendar.ics?team=lobi | ?fixture=<id> | ?competition=
// A calendar feed to subscribe to (webcal://…), or one match to add.
export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    for (const k of url.searchParams.keys()) if (!['competition', 'team', 'fixture'].includes(k)) return badRequest(`Unknown parameter: ${k}.`);
    const { league, error } = await leagueFrom(env, url);
    if (error) return error;
    let list = league.fixtures, name = `${league.competition.short_name} fixtures`;
    const fixture = url.searchParams.get('fixture');
    const teamParam = url.searchParams.get('team');
    if (fixture !== null) {
      if (!/^\d{1,9}$/.test(fixture)) return badRequest('Unknown fixture.');
      list = list.filter(f => f.id === Number(fixture));
      if (!list.length) return new Response('Not found', { status: 404 });
      name = `${list[0].home.name} vs ${list[0].away.name}`;
    } else if (teamParam) {
      const team = findTeam(league, teamParam);
      if (!team) return badRequest('Unknown team.');
      list = list.filter(f => f.home_team_id === team.id || f.away_team_id === team.id);
      name = `${team.name} fixtures`;
    }
    const ics = buildIcs(list, { calendarName: name, site: url.origin });
    const file = fixture ? `match-${fixture}.ics` : `${(teamParam || 'league').toLowerCase().replace(/[^a-z0-9-]/g, '')}-fixtures.ics`;
    return new Response(ics, { headers: {
      'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'public, max-age=300',
      'Content-Disposition': `${fixture ? 'attachment' : 'inline'}; filename="${file}"`,
    } });
  } catch (err) {
    console.error('[league] calendar', err);
    return new Response('Could not make the calendar.', { status: 500 });
  }
}
