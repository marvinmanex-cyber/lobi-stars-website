import { requireAdminUser } from '../_lib/adminEvents.js';
import { ensureAdminSchema } from '../_lib/adminSession.js';

// GET /api/admin/activity[?q=] -- the last 300 staff actions (exports,
// deletions, staff and award changes, membership confirmations...).
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  await ensureAdminSchema(env.DB);
  const q = (new URL(request.url).searchParams.get('q') || '').trim().toLowerCase().slice(0, 60);
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const { results } = await env.DB.prepare(
    `SELECT ts, staff_name, action, detail FROM admin_log
     WHERE ? = '' OR lower(staff_name || ' ' || action || ' ' || COALESCE(detail, '')) LIKE ?
     ORDER BY id DESC LIMIT 300`
  ).bind(q, like).all();
  return Response.json({ log: results }, { headers: { 'Cache-Control': 'no-store' } });
}
