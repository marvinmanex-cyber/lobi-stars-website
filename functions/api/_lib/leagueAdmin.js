// Shared by the League admin APIs (/api/admin/league/*): sign-in, the
// "sensitive action" check, and one way to change a fixture so every change
// is audit-logged, timestamped and copied to Matches & Fixtures.
import { requireAdminUser } from './adminEvents.js';
import { ensureLeagueSchema, logLeague, canDoSensitive, syncEvent, writeCentre, loadLeague, standingsFor } from './leagueDb.js';

export const ok = (data = {}) => Response.json({ ok: true, ...data }, { headers: { 'Cache-Control': 'no-store' } });
export const fail = (error, status = 400, extra = {}) => Response.json({ error, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } });

/** { admin, staff } or { denied }. Pass sensitive: true for rules, adjustments, tie decisions, import and revert. */
export async function leagueAuth(request, env, { sensitive = false } = {}) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return { denied };
  await ensureLeagueSchema(env);
  if (sensitive && !(await canDoSensitive(env.DB, admin))) {
    return { denied: fail('Only the staff named in the league admin list can do this (Settings: league_admin_emails).', 403) };
  }
  return { admin, staff: { email: admin.email || admin.name || 'owner', name: admin.name } };
}

export const body = async request => { try { return await request.json(); } catch { return null; } };

/** The editable columns of a fixture (what the audit log stores before and after). */
export const FIXTURE_COLS = ['competition_id', 'match_no', 'matchday', 'round', 'home_team_id', 'away_team_id', 'venue_id', 'kickoff_at', 'original_kickoff_at', 'status',
  'home_goals', 'away_goals', 'result_type', 'attendance', 'referee', 'report_url', 'note', 'postponed_reason', 'is_published'];
export const snapshot = f => (f ? Object.fromEntries(FIXTURE_COLS.map(k => [k, f[k] ?? null])) : null);

const CENTRE_STATUS = { scheduled: 'scheduled', live: 'live', 'half-time': 'half_time', 'full-time': 'full_time' };
const LEAGUE_ONLY = ['postponed', 'cancelled', 'abandoned', 'awarded'];

/** A fixture as it stands now (for Lobi Stars matches, with the score from Match Centre). */
export async function getFixture(db, id) {
  if (!/^\d{1,9}$/.test(String(id))) return null;
  const f = await db.prepare(`SELECT * FROM league_fixtures WHERE id = ?`).bind(Number(id)).first();
  if (!f?.event_id || LEAGUE_ONLY.includes(f.status)) return f;
  try {
    const c = await db.prepare(`SELECT status, home_score, away_score FROM match_centre WHERE event_id = ?`).bind(f.event_id).first();
    const st = c && CENTRE_STATUS[c.status];
    if (st) { f.status = st; f.home_goals = st === 'scheduled' ? null : c.home_score; f.away_goals = st === 'scheduled' ? null : c.away_score; }
  } catch { /* no Match Centre yet */ }
  return f;
}

/**
 * Changes a fixture: saves the columns, stamps updated_at/updated_by, writes
 * the audit entry, and keeps Matches & Fixtures (and Match Centre for scores)
 * in step for Lobi Stars matches. Returns the fixture after the change.
 */
export async function changeFixture(env, staff, before, changes, action) {
  const db = env.DB;
  // A status change carries the current score with it (Lobi Stars matches keep theirs in Match Centre).
  if ('status' in changes) {
    if (!('home_goals' in changes)) changes.home_goals = before.home_goals ?? null;
    if (!('away_goals' in changes)) changes.away_goals = before.away_goals ?? null;
  }
  const cols = Object.keys(changes).filter(k => FIXTURE_COLS.includes(k));
  if (cols.length) {
    await db.prepare(`UPDATE league_fixtures SET ${cols.map(c => `${c} = ?`).join(', ')}, updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
      .bind(...cols.map(c => changes[c]), staff.email, before.id).run();
  }
  const after = await db.prepare(`SELECT * FROM league_fixtures WHERE id = ?`).bind(before.id).first();
  await logLeague(db, staff, action, 'fixture', before.id, snapshot(before), snapshot(after));
  await afterFixtureChange(env, after, cols);
  return after;
}

/** Copies a change to Matches & Fixtures / Match Centre (Lobi Stars matches only). */
export async function afterFixtureChange(env, f, cols = []) {
  try {
    const eventId = await syncEvent(env, f.id);
    if (eventId && cols.some(c => ['status', 'home_goals', 'away_goals'].includes(c))) {
      await writeCentre(env.DB, eventId, f.status, f.home_goals, f.away_goals);
    }
  } catch (err) { console.error('[league] sync', err); }
  // (The cached homepage is cleared by functions/api/admin/_middleware.js after any save.)
}

/** The table as positions, for "what changed" after saving results. */
export async function tableSnapshot(env, competitionId) {
  const comp = await env.DB.prepare(`SELECT slug FROM league_competitions WHERE id = ?`).bind(competitionId).first();
  const league = await loadLeague(env, { slug: comp?.slug, publishedOnly: false });
  if (!league?.competition.has_table) return [];
  return standingsFor(league).rows.map(r => ({ pos: r.pos, teamId: r.team.id, name: r.team.name, points: r.points, gd: r.gd }));
}

export function tableChanges(before, after) {
  const was = new Map(before.map(r => [r.teamId, r]));
  return after.map(r => ({ ...r, before: was.get(r.teamId)?.pos ?? null, beforePoints: was.get(r.teamId)?.points ?? null, moved: (was.get(r.teamId)?.pos ?? r.pos) - r.pos }));
}

export async function competitionById(db, id) {
  return db.prepare(`SELECT * FROM league_competitions WHERE id = ?`).bind(Number(id)).first();
}
