import { hashPassword } from '../../_lib/password.js';
import { requireAdminUser } from '../../_lib/adminEvents.js';
import { ensureAdminSchema, logAdminAction } from '../../_lib/adminSession.js';

// PUT /api/admin/staff/:id { name?, canExport?, active?, password? }
// -- update a staff account (owner only). Deactivating signs them out.
export async function onRequestPut({ request, env, params }) {
  const { admin, denied } = await requireAdminUser(request, env, { ownerOnly: true });
  if (denied) return denied;
  await ensureAdminSchema(env.DB);
  const u = await env.DB.prepare(`SELECT * FROM admin_users WHERE id = ?`).bind(params.id).first();
  if (!u) return Response.json({ error: 'Staff account not found.' }, { status: 404 });
  let b;
  try { b = await request.json(); } catch { b = {}; }

  const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 80) : u.name;
  const canExport = typeof b.canExport === 'boolean' ? (b.canExport ? 1 : 0) : u.can_export_fan_data;
  const active = typeof b.active === 'boolean' ? (b.active ? 1 : 0) : u.active;
  let hash = u.password_hash;
  if (typeof b.password === 'string' && b.password) {
    if (b.password.length < 10) return Response.json({ error: 'Staff passwords must be at least 10 characters.' }, { status: 400 });
    hash = await hashPassword(b.password);
  }
  await env.DB.prepare(`UPDATE admin_users SET name = ?, can_export_fan_data = ?, active = ?, password_hash = ? WHERE id = ?`)
    .bind(name, canExport, active, hash, u.id).run();
  const changes = [
    name !== u.name && `name -> ${name}`,
    canExport !== u.can_export_fan_data && `export permission ${canExport ? 'granted' : 'removed'}`,
    active !== u.active && (active ? 'reactivated' : 'deactivated'),
    hash !== u.password_hash && 'password reset',
  ].filter(Boolean).join(', ');
  if (changes) await logAdminAction(env.DB, admin, 'staff_updated', `${u.name} <${u.email}>: ${changes}`);
  return Response.json({ ok: true });
}
