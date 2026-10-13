import { leagueAuth, body, ok, fail, getFixture, snapshot, afterFixtureChange, tableSnapshot, tableChanges } from '../../../../_lib/leagueAdmin.js';
import { getCompetition } from '../../../../_lib/leagueDb.js';
import { validateResultInput } from '../../../../_lib/league/validate.js';

// PUT /api/admin/league/results/matchday/:n { competition?, rows: [{ id, status, homeGoals, awayGoals,
//      resultType?, awardedTo?, attendance?, referee?, reportUrl?, note? }] }
// Checks every row first, saves them all in one batch, and answers with the
// table before and after (position changes).
export async function onRequestPut({ request, env, params }) {
  const { staff, denied } = await leagueAuth(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    const n = Number(params.n);
    if (!Number.isInteger(n) || n < 1 || n > 60) return fail('Unknown matchday.');
    const b = await body(request);
    const rows = Array.isArray(b) ? b : b?.rows;
    if (!Array.isArray(rows) || !rows.length || rows.length > 20) return fail('Send the results to save.');
    const comp = await getCompetition(db, b?.competition && /^[a-z0-9-]{1,80}$/.test(b.competition) ? b.competition : null);
    if (!comp) return fail('No competition found.', 404);

    const plan = [];
    for (const r of rows) {
      const f = await getFixture(db, r.id);
      if (!f || f.competition_id !== comp.id || f.matchday !== n) return fail(`Match ${r.id} is not in matchday ${n}.`);
      const v = validateResultInput(r, comp, f);
      if (!v.ok) return fail(`Match ${f.match_no}: ${v.error}`);
      const changes = v.value;
      const same = Object.entries(changes).every(([k, val]) => (f[k] ?? null) === (val ?? null));
      if (!same) plan.push({ f, changes });
    }
    if (!plan.length) return ok({ saved: 0, changes: [] });

    const before = await tableSnapshot(env, comp.id);
    const cols = ['status', 'home_goals', 'away_goals', 'result_type', 'attendance', 'referee', 'report_url', 'note'];
    await db.batch(plan.map(({ f, changes }) => db.prepare(`UPDATE league_fixtures SET ${cols.map(c => `${c} = ?`).join(', ')}, updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
      .bind(...cols.map(c => changes[c] ?? null), staff.email, f.id)));
    const saved = [];
    for (const { f } of plan) {
      const after = await db.prepare(`SELECT * FROM league_fixtures WHERE id = ?`).bind(f.id).first();
      await db.prepare(`INSERT INTO league_audit_log (staff_email, action, entity, entity_id, before_json, after_json) VALUES (?, 'result.set', 'fixture', ?, ?, ?)`)
        .bind(staff.email, String(f.id), JSON.stringify(snapshot(f)), JSON.stringify(snapshot(after))).run();
      await afterFixtureChange(env, after, ['status', 'home_goals', 'away_goals']);
      saved.push(f.id);
    }
    const afterTable = await tableSnapshot(env, comp.id);
    return ok({ saved: saved.length, ids: saved, before, after: afterTable, changes: tableChanges(before, afterTable) });
  } catch (err) {
    console.error('[league admin] results', err);
    return fail('Could not save the results.', 500);
  }
}
