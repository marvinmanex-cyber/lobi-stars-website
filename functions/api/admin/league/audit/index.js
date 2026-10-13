import { leagueAuth, ok, fail } from '../../../_lib/leagueAdmin.js';

// GET /api/admin/league/audit?entity=&q=&page= -- every league change: who,
// when, what, before and after (50 per page, newest first).
export async function onRequestGet({ request, env }) {
  const { denied } = await leagueAuth(request, env);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const entity = url.searchParams.get('entity');
    if (entity && !['fixture', 'adjustment', 'competition', 'team', 'venue', 'event'].includes(entity)) return fail('Unknown entity.');
    const q = (url.searchParams.get('q') || '').trim().slice(0, 60);
    const page = Math.max(1, Math.min(500, Number(url.searchParams.get('page')) || 1));
    const where = [], binds = [];
    if (entity) { where.push('entity = ?'); binds.push(entity); }
    if (q) { where.push('(action LIKE ? OR staff_email LIKE ? OR entity_id = ? OR before_json LIKE ? OR after_json LIKE ?)'); binds.push(`%${q}%`, `%${q}%`, q, `%${q}%`, `%${q}%`); }
    const sql = `FROM league_audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
    const total = (await env.DB.prepare(`SELECT COUNT(*) AS n ${sql}`).bind(...binds).first()).n;
    const { results } = await env.DB.prepare(`SELECT * ${sql} ORDER BY id DESC LIMIT 50 OFFSET ?`).bind(...binds, (page - 1) * 50).all();
    // Fixture names for readable summaries.
    const ids = [...new Set(results.filter(r => r.entity === 'fixture').map(r => Number(r.entity_id)))];
    const names = new Map();
    if (ids.length) {
      const { results: fx } = await env.DB.prepare(`SELECT f.id, f.match_no, h.name AS home, a.name AS away FROM league_fixtures f JOIN league_teams h ON h.id = f.home_team_id JOIN league_teams a ON a.id = f.away_team_id WHERE f.id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
      for (const f of fx) names.set(String(f.id), `Match ${f.match_no}: ${f.home} vs ${f.away}`);
    }
    return ok({ total, page, pages: Math.max(1, Math.ceil(total / 50)), entries: results.map(r => ({ ...r, label: names.get(r.entity_id) || null, revertable: r.entity === 'fixture' && !!r.before_json && !!r.after_json && !r.action.startsWith('revert') })) });
  } catch (err) {
    console.error('[league admin] audit', err);
    return fail('Could not load the history.', 500);
  }
}
