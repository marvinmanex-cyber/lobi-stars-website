import { requireAdminUser } from '../_lib/adminEvents.js';
import { ensureAdminSchema } from '../_lib/adminSession.js';
import { roleOf } from '../_lib/adminRoles.js';
import { ensureActivitySchema, CATEGORIES } from '../_lib/activityLog.js';
import { describeDevice } from '../_lib/adminSecurity.js';

const PAGE = 100;

// GET /api/admin/activity -- the Activity Log (logs.view; Super Admins).
//   q         words in the person, action or details
//   person    a staff id (or "owner")
//   category  security | staff | approvals | exports | matchday | commerce | fans | partners | settings | other
//   from, to  dates (YYYY-MM-DD, Nigeria time)
//   offset    for "Older"
// Each entry: who, what, when, and from where (device and rough location from their
// sign-in). Network addresses are shown to Super Admins only. Entries can't be changed.
export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureAdminSchema(db);
  await ensureActivitySchema(db);
  const u = new URL(request.url).searchParams;
  const q = (u.get('q') || '').trim().toLowerCase().slice(0, 60);
  const where = [], args = [];
  if (q) { where.push(`lower(l.staff_name || ' ' || l.action || ' ' || COALESCE(l.detail, '')) LIKE ? ESCAPE '\\'`); args.push(`%${q.replace(/[%_]/g, c => `\\${c}`)}%`); }
  if (u.get('person')) { where.push(`l.staff_id = ?`); args.push(u.get('person')); }
  if (CATEGORIES[u.get('category')]) { where.push(`COALESCE(l.category, 'other') = ?`); args.push(u.get('category')); }
  const day = (v, end) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? new Date(Date.parse(`${v}T00:00:00+01:00`) + (end ? 864e5 : 0)).toISOString() : null;
  if (day(u.get('from'))) { where.push(`l.ts >= ?`); args.push(day(u.get('from'))); }
  if (day(u.get('to'), true)) { where.push(`l.ts < ?`); args.push(day(u.get('to'), true)); }
  const offset = Math.max(0, Number(u.get('offset')) || 0);
  const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { results } = await db.prepare(
    `SELECT l.id, l.ts, l.staff_id, l.staff_name, l.action, l.detail, COALESCE(l.category, 'other') AS category, s.user_agent, s.country, s.ip
     FROM admin_log l LEFT JOIN admin_sessions s ON s.id = l.session_id ${sql} ORDER BY l.id DESC LIMIT ${PAGE + 1} OFFSET ?`
  ).bind(...args, offset).all();
  const superAdmin = roleOf(admin) === 'super_admin';
  const log = results.slice(0, PAGE).map(r => ({
    id: r.id, ts: r.ts, staff_id: r.staff_id, staff_name: r.staff_name, action: r.action, detail: r.detail, category: r.category,
    device: r.user_agent ? describeDevice(r.user_agent) : null, location: r.country || null, ip: superAdmin ? r.ip || null : undefined,
    emergency: r.staff_id === 'owner' || r.action === 'owner_code_login',
  }));
  const { results: people } = await db.prepare(`SELECT staff_id, MAX(staff_name) AS name FROM admin_log WHERE staff_id NOT IN ('unknown', 'system', 'staff') GROUP BY staff_id ORDER BY MAX(id) DESC LIMIT 300`).all();
  // The 300 most recently active people, listed by name.
  people.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  return Response.json({ log, more: results.length > PAGE, offset, categories: CATEGORIES, people, showIp: superAdmin }, { headers: { 'Cache-Control': 'no-store' } });
}
