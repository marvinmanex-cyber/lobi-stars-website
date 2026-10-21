import { requireAdminUser } from '../_lib/adminEvents.js';
import { roleOf, roleLabel, areasOf } from '../_lib/adminRoles.js';
import { IDLE_MS } from '../_lib/adminSecurity.js';
import { budgetBlocked } from '../_lib/claude.js';

// GET /api/admin/me -- who is signed in: name, role, the admin areas they
// can open, their permissions (both drive the sidebar), the export permission,
// and whether they must first choose a new password or set up two-step login.
export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env, { allowRestricted: true });
  if (denied) return denied;
  const { sessionId, ...rest } = admin;
  // Super Admins see "Monthly AI budget reached" on every admin page (one small read).
  const aiBudgetReached = !admin.restrict && admin.permissions?.includes('ai.fix') ? await budgetBlocked(env.DB) : false;
  return Response.json({ admin: { ...rest, aiBudgetReached, roleId: roleOf(admin), roleLabel: roleLabel(admin), areas: admin.restrict ? [] : areasOf(admin), permissions: admin.restrict ? [] : admin.permissions, idleMinutes: IDLE_MS / 60000 } }, { headers: { 'Cache-Control': 'no-store' } });
}

// POST /api/admin/me -- "still here": sent by admin pages while someone is using
// them, so the session isn't ended after 30 minutes without activity.
export async function onRequestPost({ request, env }) {
  const { denied } = await requireAdminUser(request, env, { allowRestricted: true });
  if (denied) return denied;
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
