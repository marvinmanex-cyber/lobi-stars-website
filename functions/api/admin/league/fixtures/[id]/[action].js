import { leagueAuth, body, ok, fail, getFixture, changeFixture, snapshot } from '../../../../_lib/leagueAdmin.js';
import { lagosDateTimeToUtcIso, formatShortDate } from '../../../../_lib/league/time.js';

// POST /api/admin/league/fixtures/:id/postpone   { reason }
// POST /api/admin/league/fixtures/:id/reschedule { date, time, venueId? }  (Nigerian time)
// POST /api/admin/league/fixtures/:id/swap       swap home and away (scheduled, no result)
// POST /api/admin/league/fixtures/:id/live       { action: kickoff | goal_home | goal_away | undo_goal_home |
//                                                   undo_goal_away | half_time | second_half | full_time }
// Every change is audit-logged; goal buttons ignore the same tap twice within 3 seconds.
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);

export async function onRequestPost({ request, env, params }) {
  const { staff, denied } = await leagueAuth(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    const f = await getFixture(db, params.id);
    if (!f) return fail('Fixture not found.', 404);
    const b = (await body(request)) || {};
    const action = params.action;

    if (action === 'postpone') {
      const reason = text(b.reason, 200);
      if (reason.length < 3) return fail('Give a reason for the postponement.');
      if (['full_time', 'awarded'].includes(f.status)) return fail('This match has a result.', 409);
      const after = await changeFixture(env, staff, f, {
        status: 'postponed', original_kickoff_at: f.original_kickoff_at || f.kickoff_at, kickoff_at: null,
        postponed_reason: reason, home_goals: null, away_goals: null, note: 'Postponed',
      }, 'fixture.postpone');
      return ok({ fixture: snapshot(after) });
    }

    if (action === 'reschedule') {
      const iso = lagosDateTimeToUtcIso(b.date, b.time || '16:00');
      if (!iso) return fail('Enter a real date (YYYY-MM-DD) and time (HH:MM, Nigerian time).');
      if (['full_time', 'awarded'].includes(f.status)) return fail('This match has a result.', 409);
      const changes = { kickoff_at: iso, status: 'scheduled', postponed_reason: null };
      const was = f.original_kickoff_at || f.kickoff_at;
      changes.note = was && was !== iso ? `Rescheduled from ${formatShortDate(was)}` : null;
      if (b.venueId !== undefined && b.venueId !== null && b.venueId !== '') {
        const v = await db.prepare(`SELECT id FROM league_venues WHERE id = ?`).bind(Number(b.venueId)).first();
        if (!v) return fail('Unknown venue.');
        changes.venue_id = v.id;
      }
      const after = await changeFixture(env, staff, f, changes, 'fixture.reschedule');
      return ok({ fixture: snapshot(after) });
    }

    if (action === 'swap') {
      if (f.status !== 'scheduled' || f.home_goals !== null || f.away_goals !== null) return fail('Only a scheduled match with no result can be swapped.', 409);
      const venue = (await db.prepare(`SELECT home_venue_id FROM league_teams WHERE id = ?`).bind(f.away_team_id).first())?.home_venue_id ?? f.venue_id;
      const after = await changeFixture(env, staff, f, { home_team_id: f.away_team_id, away_team_id: f.home_team_id, venue_id: venue }, 'fixture.swap');
      return ok({ fixture: snapshot(after) });
    }

    if (action === 'live') {
      const a = String(b.action || '');
      const goals = { h: f.home_goals ?? 0, a: f.away_goals ?? 0 };
      // Double-tap protection: the same goal button within 3 seconds is ignored.
      if (/goal/.test(a)) {
        const last = await db.prepare(`SELECT action, created_at FROM league_audit_log WHERE entity = 'fixture' AND entity_id = ? ORDER BY id DESC LIMIT 1`).bind(String(f.id)).first();
        if (last && last.action === `live.${a}` && Date.now() - Date.parse(last.created_at.replace(' ', 'T') + 'Z') < 3000) {
          return ok({ ignored: true, fixture: snapshot(f), message: 'Ignored a second tap.' });
        }
      }
      const live = ['live', 'half_time'];
      let changes;
      switch (a) {
        case 'kickoff': if (!['scheduled', 'postponed'].includes(f.status)) return fail('The match has already started.', 409); changes = { status: 'live', home_goals: 0, away_goals: 0 }; break;
        case 'goal_home': if (!live.includes(f.status)) return fail('Start the match first.', 409); changes = { home_goals: Math.min(30, goals.h + 1), away_goals: goals.a }; break;
        case 'goal_away': if (!live.includes(f.status)) return fail('Start the match first.', 409); changes = { home_goals: goals.h, away_goals: Math.min(30, goals.a + 1) }; break;
        case 'undo_goal_home': if (!live.includes(f.status) || goals.h < 1) return fail('No home goal to take away.', 409); changes = { home_goals: goals.h - 1, away_goals: goals.a }; break;
        case 'undo_goal_away': if (!live.includes(f.status) || goals.a < 1) return fail('No away goal to take away.', 409); changes = { home_goals: goals.h, away_goals: goals.a - 1 }; break;
        case 'half_time': if (f.status !== 'live') return fail('The match is not in play.', 409); changes = { status: 'half_time' }; break;
        case 'second_half': if (f.status !== 'half_time') return fail('The match is not at half time.', 409); changes = { status: 'live' }; break;
        case 'full_time': if (!live.includes(f.status)) return fail('The match is not in play.', 409); changes = { status: 'full_time', home_goals: goals.h, away_goals: goals.a }; break;
        default: return fail('Unknown live action.');
      }
      // Linked matches: the score may have been changed in Live Match Control; start from it.
      const after = await changeFixture(env, staff, f, changes, `live.${a}`);
      return ok({ fixture: snapshot(after), savedAt: new Date().toISOString() });
    }

    return fail('Unknown action.', 404);
  } catch (err) {
    console.error('[league admin] action', err);
    return fail('Could not save. Please try again.', 500);
  }
}
