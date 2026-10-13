import { leagueAuth, body, ok, fail } from '../../../_lib/leagueAdmin.js';
import { getCompetition, logLeague } from '../../../_lib/leagueDb.js';

// GET  /api/admin/league/adjustments?competition=  -- every adjustment, active and voided
// POST /api/admin/league/adjustments { competition?, teamId, points, reason }
//      A points deduction (negative) or award. Never deleted, only voided.
export async function onRequestGet({ request, env }) {
  const { denied } = await leagueAuth(request, env);
  if (denied) return denied;
  try {
    const slug = new URL(request.url).searchParams.get('competition');
    const comp = await getCompetition(env.DB, slug && /^[a-z0-9-]{1,80}$/.test(slug) ? slug : null);
    if (!comp) return fail('No competition found.', 404);
    const { results } = await env.DB.prepare(`SELECT a.*, t.name AS team_name FROM league_table_adjustments a JOIN league_teams t ON t.id = a.team_id WHERE a.competition_id = ? ORDER BY a.id DESC`).bind(comp.id).all();
    return ok({ adjustments: results });
  } catch (err) {
    console.error('[league admin] adjustments', err);
    return fail('Could not load the adjustments.', 500);
  }
}

export async function onRequestPost({ request, env }) {
  const { staff, denied } = await leagueAuth(request, env, { sensitive: true });
  if (denied) return denied;
  try {
    const db = env.DB;
    const b = (await body(request)) || {};
    const comp = await getCompetition(db, b.competition && /^[a-z0-9-]{1,80}$/.test(b.competition) ? b.competition : null);
    if (!comp) return fail('No competition found.', 404);
    const points = Number(b.points);
    if (!Number.isInteger(points) || points === 0 || Math.abs(points) > 30) return fail('Points must be a whole number (negative for a deduction), not 0.');
    const reason = String(b.reason || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
    if (reason.length < 5 || reason.length > 200) return fail('Give the reason (5 to 200 characters), e.g. "Fielded an ineligible player, NNL ruling 12/2026".');
    const team = await db.prepare(`SELECT t.id, t.name FROM league_teams t JOIN league_competition_teams ct ON ct.team_id = t.id WHERE ct.competition_id = ? AND t.id = ?`).bind(comp.id, Number(b.teamId)).first();
    if (!team) return fail('Choose a club in this competition.');
    const r = await db.prepare(`INSERT INTO league_table_adjustments (competition_id, team_id, points_delta, reason, created_by) VALUES (?, ?, ?, ?, ?)`).bind(comp.id, team.id, points, reason, staff.email).run();
    await logLeague(db, staff, 'adjustment.add', 'adjustment', r.meta.last_row_id, null, { team: team.name, points, reason });
    return ok({ id: r.meta.last_row_id });
  } catch (err) {
    console.error('[league admin] add adjustment', err);
    return fail('Could not save the adjustment.', 500);
  }
}
