import { leagueAuth, body, ok, fail, getFixture, changeFixture } from '../../../../_lib/leagueAdmin.js';
import { getCompetition } from '../../../../_lib/leagueDb.js';
import { toLagos, lagosDateTimeToUtcIso, formatShortDate, formatTime } from '../../../../_lib/league/time.js';

// POST /api/admin/league/matchdays/:n/bulk { competition?, shiftDays?, setTime?, status?, apply? }
// Changes every fixture of the matchday that is still 'scheduled'. Without
// apply: true it only returns the preview (old and new date/time per match).
export async function onRequestPost({ request, env, params }) {
  const { staff, denied } = await leagueAuth(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    const n = Number(params.n);
    if (!Number.isInteger(n) || n < 1 || n > 60) return fail('Unknown matchday.');
    const b = (await body(request)) || {};
    const comp = await getCompetition(db, b.competition && /^[a-z0-9-]{1,80}$/.test(b.competition) ? b.competition : null);
    if (!comp) return fail('No competition found.', 404);
    const shift = b.shiftDays === undefined || b.shiftDays === '' ? 0 : Number(b.shiftDays);
    if (!Number.isInteger(shift) || Math.abs(shift) > 60) return fail('Shift by a whole number of days (up to 60).');
    const setTime = b.setTime ? String(b.setTime) : null;
    if (setTime && !/^\d{1,2}:\d{2}$/.test(setTime)) return fail('Time must be HH:MM (24-hour, Nigerian time).');
    if (b.status && !['postponed', 'scheduled'].includes(b.status)) return fail('Bulk status can only be postponed.');
    if (!shift && !setTime && !b.status) return fail('Choose what to change.');
    const { results } = await db.prepare(`SELECT id FROM league_fixtures WHERE competition_id = ? AND matchday = ? ORDER BY match_no`).bind(comp.id, n).all();
    const rows = [];
    for (const r of results) {
      const f = await getFixture(db, r.id);
      if (f.status !== 'scheduled' || !f.kickoff_at) { rows.push({ id: f.id, skipped: `Not changed (${f.status.replace('_', ' ')})` }); continue; }
      const l = toLagos(f.kickoff_at);
      const date = new Date(Date.parse(`${l.date}T00:00:00Z`) + shift * 864e5).toISOString().slice(0, 10);
      const iso = b.status === 'postponed' ? null : lagosDateTimeToUtcIso(date, setTime || l.time);
      rows.push({ id: f.id, matchNo: f.match_no, from: `${formatShortDate(f.kickoff_at)}, ${formatTime(f.kickoff_at)}`, to: iso ? `${formatShortDate(iso)}, ${formatTime(iso)}` : 'Postponed', iso, fixture: f });
    }
    if (!b.apply) return ok({ preview: rows.map(({ fixture, ...r }) => r) });
    const reason = String(b.reason || '').trim().slice(0, 200);
    if (b.status === 'postponed' && reason.length < 3) return fail('Give a reason for the postponement.');
    let changed = 0;
    for (const r of rows) {
      if (r.skipped) continue;
      const changes = b.status === 'postponed'
        ? { status: 'postponed', original_kickoff_at: r.fixture.original_kickoff_at || r.fixture.kickoff_at, kickoff_at: null, postponed_reason: reason, note: 'Postponed' }
        : { kickoff_at: r.iso, note: shift ? `Rescheduled from ${formatShortDate(r.fixture.kickoff_at)}` : r.fixture.note };
      await changeFixture(env, staff, r.fixture, changes, 'matchday.bulk');
      changed++;
    }
    return ok({ changed, preview: rows.map(({ fixture, ...r }) => r) });
  } catch (err) {
    console.error('[league admin] bulk', err);
    return fail('Could not change the matchday.', 500);
  }
}
