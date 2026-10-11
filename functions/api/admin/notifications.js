import { requireAdminUser } from '../_lib/adminEvents.js';
import { canAccess } from '../_lib/adminRoles.js';
import { ensureContactsSchema } from '../_lib/contacts.js';
import { ensureAnalyticsSchema } from '../_lib/analytics.js';
import { sqlTs, isoTs } from '../_lib/reportRange.js';

// GET /api/admin/notifications -- the admin bell: new messages (last 48h),
// Predict & Win prizes not yet paid, and commentary stream errors today.
export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  const items = [];
  const tableExists = async n => !!(await db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).bind(n).first());

  if (canAccess(admin, 'fans') || canAccess(admin, 'inbox')) {
    await ensureContactsSchema(db);
    const n = (await db.prepare(`SELECT COUNT(*) AS n FROM enquiries WHERE created_at >= ?`).bind(isoTs(Date.now() - 48 * 3600e3)).first()).n || 0;
    if (n) items.push({ icon: '✉️', title: `${n} new message${n === 1 ? '' : 's'} in the last 48 hours`, sub: 'Contact, sponsorship and hospitality enquiries', href: '/admin/fans/?source=contact_form' });
  }
  if (canAccess(admin, 'matchday') && await tableExists('prediction_results')) {
    const { results } = await db.prepare(
      `SELECT r.event_id, e.home_team, e.away_team, r.prize_amount FROM prediction_results r LEFT JOIN events e ON e.id = r.event_id
       WHERE r.winner_member_id IS NOT NULL AND r.prize_paid = 0 ORDER BY r.calculated_at DESC LIMIT 5`
    ).all();
    for (const w of results) items.push({ icon: '🏆', title: `Predict & Win prize not paid yet`, sub: `${w.home_team} vs ${w.away_team} · ₦${Number(w.prize_amount).toLocaleString('en-NG')}`, href: `/admin/predictions/?id=${encodeURIComponent(w.event_id)}` });
  }
  if (canAccess(admin, 'matchday')) {
    await ensureAnalyticsSchema(db);
    const since = sqlTs(Date.now() - 24 * 3600e3);
    const n = (await db.prepare(`SELECT COUNT(*) AS n FROM track_events WHERE name = 'commentary_error' AND ts >= ?`).bind(since).first()).n || 0;
    if (n) items.push({ icon: '📻', title: `Commentary stream problems: ${n} in the last 24 hours`, sub: 'Fans saw "Reconnecting". Check the stream on Live Commentary.', href: '/admin/commentary/' });
  }
  return Response.json({ items }, { headers: { 'Cache-Control': 'no-store' } });
}
