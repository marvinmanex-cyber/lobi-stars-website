import { requireAdminUser } from '../_lib/adminEvents.js';
import { ensureAdminSchema } from '../_lib/adminSession.js';

// GET /api/admin/export-log -- the last 100 exports, deletions and unsubscribes.
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  await ensureAdminSchema(env.DB);
  const { results } = await env.DB.prepare(
    `SELECT ts, staff_name, action, detail FROM admin_log
     WHERE action LIKE 'export_%' OR action LIKE 'fan_%' OR action = 'partner_report'
     ORDER BY id DESC LIMIT 100`
  ).all();
  return Response.json({ log: results }, { headers: { 'Cache-Control': 'no-store' } });
}
