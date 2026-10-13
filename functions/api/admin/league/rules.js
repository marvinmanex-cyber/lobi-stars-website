import { leagueAuth, body, ok, fail } from '../../_lib/leagueAdmin.js';
import { getCompetition, logLeague, loadLeague, standingsFor } from '../../_lib/leagueDb.js';
import { validateRules } from '../../_lib/league/validate.js';
import { CRITERIA, CRITERION_LABELS } from '../../_lib/league/standings.js';

// GET   /api/admin/league/rules?competition=
// PATCH /api/admin/league/rules[?preview=1] { competition?, pointsWin?, pointsDraw?, pointsLoss?,
//        tiebreakOrder?, zones?, includeLive?, awardedHomeGoals?, awardedAwayGoals? }
// With preview=1 the table is worked out with the proposed rules and nothing is saved.
const RULE_COLS = ['points_win', 'points_draw', 'points_loss', 'tiebreak_order', 'zones', 'include_live', 'awarded_home_goals', 'awarded_away_goals'];
const pick = c => Object.fromEntries(RULE_COLS.map(k => [k, c[k]]));
const compact = s => s.rows.map(r => ({ pos: r.pos, name: r.team.name, points: r.points, gd: r.gd }));

export async function onRequestGet({ request, env }) {
  const { denied } = await leagueAuth(request, env);
  if (denied) return denied;
  const slug = new URL(request.url).searchParams.get('competition');
  const comp = await getCompetition(env.DB, slug && /^[a-z0-9-]{1,80}$/.test(slug) ? slug : null);
  if (!comp) return fail('No competition found.', 404);
  return ok({ rules: pick(comp), criteria: CRITERIA.map(c => ({ key: c, label: CRITERION_LABELS[c] })) });
}

export async function onRequestPatch({ request, env }) {
  const preview = new URL(request.url).searchParams.get('preview') === '1';
  const { staff, denied } = await leagueAuth(request, env, { sensitive: !preview });
  if (denied) return denied;
  try {
    const db = env.DB;
    const b = (await body(request)) || {};
    const comp = await getCompetition(db, b.competition && /^[a-z0-9-]{1,80}$/.test(b.competition) ? b.competition : null);
    if (!comp) return fail('No competition found.', 404);
    const count = (await db.prepare(`SELECT COUNT(*) AS n FROM league_competition_teams WHERE competition_id = ?`).bind(comp.id).first()).n;
    const v = validateRules(b, count);
    if (!v.ok) return fail(v.error);
    if (!Object.keys(v.value).length) return fail('Nothing to change.');
    const league = await loadLeague(env, { slug: comp.slug });
    const before = compact(standingsFor(league));
    const proposed = { ...league, competition: { ...league.competition, ...v.value } };
    const after = compact(standingsFor(proposed));
    if (preview) return ok({ preview: true, before, after });
    const cols = Object.keys(v.value);
    await db.prepare(`UPDATE league_competitions SET ${cols.map(c => `${c} = ?`).join(', ')}, rules_updated_at = ? WHERE id = ?`).bind(...cols.map(c => v.value[c]), new Date().toISOString(), comp.id).run();
    const saved = await db.prepare(`SELECT * FROM league_competitions WHERE id = ?`).bind(comp.id).first();
    await logLeague(db, staff, 'rules.update', 'competition', comp.id, pick(comp), pick(saved));
    return ok({ rules: pick(saved), before, after });
  } catch (err) {
    console.error('[league admin] rules', err);
    return fail('Could not save the rules.', 500);
  }
}
