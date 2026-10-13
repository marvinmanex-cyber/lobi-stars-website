import { leagueAuth, body, ok, fail } from '../../_lib/leagueAdmin.js';
import { getCompetition, logLeague, loadLeague, standingsFor } from '../../_lib/leagueDb.js';

// GET /api/admin/league/tie-overrides?competition= -- the decisions, and the
//     groups of clubs currently level on EVERY rule (only they need one).
// PUT /api/admin/league/tie-overrides { competition?, decisions: [{ teamId, rankHint }], reason }
//     Lower rank hint = placed higher. Used only between clubs level on everything.
//     An empty decisions list clears them.
export async function onRequestGet({ request, env }) {
  const { denied } = await leagueAuth(request, env);
  if (denied) return denied;
  try {
    const slug = new URL(request.url).searchParams.get('competition');
    const league = await loadLeague(env, { slug: slug && /^[a-z0-9-]{1,80}$/.test(slug) ? slug : null });
    if (!league) return fail('No competition found.', 404);
    const s = standingsFor(league);
    const groups = [];
    if (!s.preSeason) {
      const seen = new Set();
      for (const r of s.rows) {
        if (!r.level || seen.has(r.team.id)) continue;
        const g = s.rows.filter(x => x.team.id === r.team.id || r.tiedWith.includes(x.team.name));
        g.forEach(x => seen.add(x.team.id));
        groups.push(g.map(x => ({ teamId: x.team.id, name: x.team.name, pos: x.pos })));
      }
    }
    return ok({ overrides: league.overrides, groups });
  } catch (err) {
    console.error('[league admin] tie overrides', err);
    return fail('Could not load the tie decisions.', 500);
  }
}

export async function onRequestPut({ request, env }) {
  const { staff, denied } = await leagueAuth(request, env, { sensitive: true });
  if (denied) return denied;
  try {
    const db = env.DB;
    const b = (await body(request)) || {};
    const comp = await getCompetition(db, b.competition && /^[a-z0-9-]{1,80}$/.test(b.competition) ? b.competition : null);
    if (!comp) return fail('No competition found.', 404);
    const decisions = Array.isArray(b.decisions) ? b.decisions : null;
    if (!decisions || decisions.length > 30) return fail('Send the decisions.');
    const reason = String(b.reason || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
    if (decisions.length && (reason.length < 5 || reason.length > 200)) return fail('Give the reason, e.g. the league ruling (5 to 200 characters).');
    for (const d of decisions) {
      if (!Number.isInteger(Number(d.rankHint)) || Number(d.rankHint) < 1 || Number(d.rankHint) > 99) return fail('Order numbers must be 1 to 99.');
      if (!(await db.prepare(`SELECT 1 FROM league_competition_teams WHERE competition_id = ? AND team_id = ?`).bind(comp.id, Number(d.teamId)).first())) return fail('Unknown club.');
    }
    const before = (await db.prepare(`SELECT team_id, rank_hint, reason FROM league_tie_overrides WHERE competition_id = ?`).bind(comp.id).all()).results;
    const ids = decisions.map(d => Number(d.teamId));
    const stmts = [db.prepare(`DELETE FROM league_tie_overrides WHERE competition_id = ? ${ids.length ? `AND team_id IN (${ids.map(() => '?').join(',')})` : ''}`).bind(comp.id, ...ids)];
    for (const d of decisions) stmts.push(db.prepare(`INSERT INTO league_tie_overrides (competition_id, team_id, rank_hint, reason, created_by) VALUES (?, ?, ?, ?, ?)`).bind(comp.id, Number(d.teamId), Number(d.rankHint), reason, staff.email));
    if (b.clearAll) stmts.splice(0, 1, db.prepare(`DELETE FROM league_tie_overrides WHERE competition_id = ?`).bind(comp.id));
    await db.batch(stmts);
    const after = (await db.prepare(`SELECT team_id, rank_hint, reason FROM league_tie_overrides WHERE competition_id = ?`).bind(comp.id).all()).results;
    await db.prepare(`UPDATE league_competitions SET rules_updated_at = ? WHERE id = ?`).bind(new Date().toISOString(), comp.id).run();
    await logLeague(db, staff, 'tie.update', 'competition', comp.id, before, after);
    return ok({ overrides: after });
  } catch (err) {
    console.error('[league admin] save tie overrides', err);
    return fail('Could not save the tie decision.', 500);
  }
}
