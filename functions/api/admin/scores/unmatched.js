import { scoresGuard, json } from '../../_lib/scores/api.js';
import { linkUnmatched, dismissUnmatched, loadTeams } from '../../_lib/scores/model.js';
import { logAdminAction } from '../../_lib/adminSession.js';

// Admin › League › Unmatched team names: names that arrived in score reports
// and match no team. Link one to a team once (saved as a new alias), or dismiss it.
// GET                                   -- open names (and the last 30 linked/dismissed), the teams
// POST { action: 'link', id, teamId }   -- becomes an alias of that team
// POST { action: 'dismiss', id }
export async function onRequestGet({ request, env }) {
  const { denied } = await scoresGuard(request, env);
  if (denied) return denied;
  const db = env.DB;
  const open = (await db.prepare(`SELECT * FROM score_unmatched_names WHERE status = 'open' ORDER BY last_seen DESC LIMIT 200`).all()).results;
  const done = (await db.prepare(`SELECT u.*, t.name AS team_name FROM score_unmatched_names u LEFT JOIN league_teams t ON t.id = u.team_id WHERE u.status != 'open' ORDER BY u.resolved_at DESC LIMIT 30`).all()).results;
  const teams = (await loadTeams(env)).map(t => ({ id: t.id, name: t.name, aliases: JSON.parse(t.aliases || '[]') })).sort((a, b) => a.name.localeCompare(b.name));
  return json({ open, done, teams });
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await scoresGuard(request, env, { write: true });
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  let r;
  if (b.action === 'link') {
    r = await linkUnmatched(env, b.id, b.teamId, admin);
    if (r.ok) await logAdminAction(env.DB, admin, 'score_alias', `"${r.alias}" linked to ${r.team.name} (saved as an alias)`);
  } else if (b.action === 'dismiss') r = await dismissUnmatched(env, b.id, admin);
  else return json({ error: 'Unknown action' }, 400);
  return r.error ? json(r, 400) : json(r);
}
