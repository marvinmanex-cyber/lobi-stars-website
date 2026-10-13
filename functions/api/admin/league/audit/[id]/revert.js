import { leagueAuth, ok, fail, getFixture, changeFixture, snapshot, FIXTURE_COLS } from '../../../../_lib/leagueAdmin.js';

// POST /api/admin/league/audit/:id/revert -- puts a fixture back as it was
// before that change. Refused if the fixture has been changed again since
// (undo the later change first). Writes its own history entry.
export async function onRequestPost({ request, env, params }) {
  const { staff, denied } = await leagueAuth(request, env, { sensitive: true });
  if (denied) return denied;
  try {
    const db = env.DB;
    if (!/^\d{1,9}$/.test(String(params.id))) return fail('History entry not found.', 404);
    const entry = await db.prepare(`SELECT * FROM league_audit_log WHERE id = ?`).bind(Number(params.id)).first();
    if (!entry) return fail('History entry not found.', 404);
    if (entry.entity !== 'fixture' || !entry.before_json || !entry.after_json) return fail('Only changes to a fixture can be undone here.', 409);
    const f = await getFixture(db, entry.entity_id);
    if (!f) return fail('That fixture no longer exists.', 409);
    const after = JSON.parse(entry.after_json), before = JSON.parse(entry.before_json);
    const now = snapshot(f);
    const differs = FIXTURE_COLS.filter(k => (now[k] ?? null) !== (after[k] ?? null));
    if (differs.length) return fail(`This fixture has been changed again since (${differs.join(', ')}). Undo the later change first.`, 409);
    const changes = Object.fromEntries(FIXTURE_COLS.filter(k => k !== 'competition_id' && k !== 'match_no').map(k => [k, before[k] ?? null]));
    await changeFixture(env, staff, f, changes, `revert.${entry.id}`);
    return ok();
  } catch (err) {
    console.error('[league admin] revert', err);
    return fail('Could not undo the change.', 500);
  }
}
