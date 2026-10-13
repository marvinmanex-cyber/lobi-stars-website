import { leagueAuth, ok, fail } from '../../_lib/leagueAdmin.js';
import { loadLeague } from '../../_lib/leagueDb.js';
import { tablePayload } from '../../_lib/leagueApi.js';
import { explainPosition, computeStandings } from '../../_lib/league/standings.js';

// GET /api/admin/league/table?competition=&scope=&upto= -- the table with an
// explanation of every position ("Explain this position").
export async function onRequestGet({ request, env }) {
  const { denied } = await leagueAuth(request, env);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const slug = url.searchParams.get('competition');
    if (slug && !/^[a-z0-9-]{1,80}$/.test(slug)) return fail('Unknown competition.');
    const scope = url.searchParams.get('scope') || 'overall';
    if (!['overall', 'home', 'away'].includes(scope)) return fail('scope must be overall, home or away.');
    const u = url.searchParams.get('upto');
    const upTo = u ? Number(u) : null;
    if (upTo !== null && !(Number.isInteger(upTo) && upTo >= 1 && upTo <= 60)) return fail('Unknown matchday.');
    const league = await loadLeague(env, { slug: slug || null });
    if (!league) return fail('No competition found.', 404);
    const payload = tablePayload(league, { scope, upTo });
    const raw = computeStandings({ teams: league.teams, fixtures: league.fixtures, adjustments: league.adjustments.filter(a => a.is_active === 1), tieOverrides: league.overrides, rules: league.competition, upToMatchday: upTo, scope });
    payload.rows.forEach((r, i) => { r.explain = explainPosition(raw.rows[i], raw.rows); });
    const days = [...new Set(league.fixtures.map(f => f.matchday).filter(Boolean))].sort((a, b) => a - b);
    return ok({ ...payload, matchdays: days, adjustments: league.adjustments, overrides: league.overrides, teams: league.teams, competitionRow: league.competition });
  } catch (err) {
    console.error('[league admin] table', err);
    return fail('Could not load the table.', 500);
  }
}
