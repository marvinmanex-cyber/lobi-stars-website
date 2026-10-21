import { leagueAuth, body, ok, fail, getFixture, changeFixture, snapshot } from '../../../_lib/leagueAdmin.js';
import { logLeague } from '../../../_lib/leagueDb.js';
import { syncChecklistsQuietly } from '../../../_lib/matchChecklist.js';
import { validateFixtureInput } from '../../../_lib/league/validate.js';

// PATCH  /api/admin/league/fixtures/:id { date?, time?, venueId?, status?, note?, isPublished?, referee?, attendance?, reportUrl? }
//        Date and time are Nigerian time; stored as UTC. Scores are entered
//        on the Results screen (or Live mode), not here.
// DELETE /api/admin/league/fixtures/:id -- only a scheduled fixture with no
//        result that was never played; otherwise cancel it instead.
export async function onRequestPatch({ request, env, params }) {
  const { staff, denied } = await leagueAuth(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    const f = await getFixture(db, params.id);
    if (!f) return fail('Fixture not found.', 404);
    const b = await body(request);
    if (!b) return fail('Nothing to change.');
    const v = validateFixtureInput(b, { partial: true });
    if (!v.ok) return fail(v.error);
    const c = v.value;
    if (c.status && ['full_time', 'awarded', 'live', 'half_time'].includes(c.status) && c.status !== f.status) return fail('Enter scores and results on the Results screen or in Live mode.');
    if (c.status === 'scheduled' && Number.isInteger(f.home_goals)) return fail('This match has a score: clear it on the Results screen first.');
    if (c.venue_id != null && !(await db.prepare(`SELECT id FROM league_venues WHERE id = ?`).bind(c.venue_id).first())) return fail('Unknown venue.');
    if (c.kickoff_at && f.status === 'postponed' && !c.status) c.status = 'scheduled';
    if (c.status === 'postponed') { c.kickoff_at = null; c.original_kickoff_at = f.original_kickoff_at || f.kickoff_at; }
    if (c.status === 'cancelled' || c.status === 'postponed') { c.home_goals = null; c.away_goals = null; }
    if (!Object.keys(c).length) return fail('Nothing to change.');
    const after = await changeFixture(env, staff, f, c, 'fixture.update');
    await syncChecklistsQuietly(env); // Match Checklist: reschedule, postpone or cancel
    return ok({ fixture: snapshot(after) });
  } catch (err) {
    console.error('[league admin] patch fixture', err);
    return fail('Could not save the change.', 500);
  }
}

export async function onRequestDelete({ request, env, params }) {
  const { staff, denied } = await leagueAuth(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    const f = await getFixture(db, params.id);
    if (!f) return fail('Fixture not found.', 404);
    if (f.status !== 'scheduled' || f.home_goals !== null || f.away_goals !== null) return fail('Only a scheduled fixture with no result can be deleted. Cancel it instead.', 409);
    if (f.event_id) {
      const sold = await db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE event_id = ?`).bind(f.event_id).first().catch(() => ({ n: 0 }));
      if (sold?.n > 0) return fail('Tickets have been ordered for this match. Cancel it instead.', 409);
      const centre = await db.prepare(`SELECT status FROM match_centre WHERE event_id = ?`).bind(f.event_id).first().catch(() => null);
      if (centre && centre.status !== 'scheduled') return fail('This match has been started in Live Match Control. Cancel it instead.', 409);
      await db.prepare(`UPDATE events SET active = 0 WHERE id = ?`).bind(f.event_id).run();
    }
    await db.prepare(`DELETE FROM league_fixtures WHERE id = ?`).bind(f.id).run();
    await logLeague(db, staff, 'fixture.delete', 'fixture', f.id, snapshot(f), null);
    await syncChecklistsQuietly(env);
    return ok();
  } catch (err) {
    console.error('[league admin] delete fixture', err);
    return fail('Could not delete the fixture.', 500);
  }
}
