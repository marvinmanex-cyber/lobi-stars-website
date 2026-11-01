import { requireAdminUser } from '../_lib/adminEvents.js';
import { listStaff, listNotes, activityPage, ensureKitchenSchema, ROLES } from '../_lib/matchdayKitchen.js';

// Admin › Commerce › MatchDay Kitchen (read-only): the kitchen staff, shifts,
// handover notes and the activity log of the MatchDay Kitchen staff area.
// Nothing can be added, changed or deleted here (that is done by the Super
// Admins inside MatchDay Kitchen, and the activity log can never be changed).
// GET ?view=staff|shifts|notes|activity [&staff=&day=&page=]
const J = (d, s = 200) => Response.json(d, { status: s, headers: { 'Cache-Control': 'no-store' } });
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureKitchenSchema(db);
  const q = new URL(request.url).searchParams;
  const view = q.get('view') || 'staff';
  if (view === 'staff') return J({ staff: await listStaff(db) });
  if (view === 'shifts') {
    const { results } = await db.prepare(`SELECT name, code, role, started_at, ended_at FROM mk_shifts ORDER BY started_at DESC LIMIT 300`).all();
    return J({ shifts: results.map(s => ({ ...s, role: ROLES[s.role] || (s.role === 'super_admin' ? 'Super admin' : s.role) })) });
  }
  if (view === 'notes') return J({ notes: await listNotes(db) });
  if (view === 'activity') {
    const r = await activityPage(db, { userId: q.get('staff') || '', day: q.get('day') || '', page: q.get('page') || 1 });
    return J({ ...r, rows: r.rows.map(a => ({ at: a.at, who: a.actor_name, code: a.actor_code, action: a.action, details: a.details, ip: a.ip })), staff: (await listStaff(db)).map(s => ({ id: s.id, name: `${s.name} (${s.staffId})` })) });
  }
  return J({ error: 'Unknown view.' }, 400);
}
export const onRequestPost = () => J({ error: 'This page is read-only.' }, 405);
