import { leagueAuth, body, ok, fail } from '../../../../_lib/leagueAdmin.js';
import { logLeague } from '../../../../_lib/leagueDb.js';

// POST /api/admin/league/adjustments/:id/void { reason } -- takes an adjustment
// out of the table (it stays in the list, marked voided, with who and why).
export async function onRequestPost({ request, env, params }) {
  const { staff, denied } = await leagueAuth(request, env, { sensitive: true });
  if (denied) return denied;
  try {
    const db = env.DB;
    if (!/^\d{1,9}$/.test(String(params.id))) return fail('Adjustment not found.', 404);
    const a = await db.prepare(`SELECT * FROM league_table_adjustments WHERE id = ?`).bind(Number(params.id)).first();
    if (!a) return fail('Adjustment not found.', 404);
    if (!a.is_active) return fail('This adjustment is already voided.', 409);
    const reason = String((await body(request))?.reason || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
    if (reason.length < 5 || reason.length > 200) return fail('Say why it is being voided (5 to 200 characters).');
    await db.prepare(`UPDATE league_table_adjustments SET is_active = 0, voided_by = ?, voided_at = datetime('now'), void_reason = ? WHERE id = ?`).bind(staff.email, reason, a.id).run();
    await logLeague(db, staff, 'adjustment.void', 'adjustment', a.id, { is_active: 1 }, { is_active: 0, reason });
    return ok();
  } catch (err) {
    console.error('[league admin] void adjustment', err);
    return fail('Could not void the adjustment.', 500);
  }
}
