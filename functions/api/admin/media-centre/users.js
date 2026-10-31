import { requireAdminUser } from '../../_lib/adminEvents.js';
import { listUsers, createUser, updateUser, json } from '../../_lib/mediaCentre.js';

// Super Admins (permission media.centre.manage, see adminRoles.js): Media Centre users.
// GET  -- every user.
// POST { action: 'create', loginId, fullName, password }
//      { action: 'reset_password' | 'login_id' | 'full_name' | 'disable' | 'enable' | 'unlock' | 'sign_out', id, ... }
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  return json({ users: await listUsers(env.DB) });
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  const r = b.action === 'create'
    ? await createUser(env, admin, request, b)
    : await updateUser(env, admin, request, String(b.id || ''), b);
  return r.ok ? json({ ok: true, id: r.id, users: await listUsers(env.DB) }) : json({ error: r.error }, 400);
}
