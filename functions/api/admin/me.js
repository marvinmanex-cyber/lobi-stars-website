import { requireAdminUser } from '../_lib/adminEvents.js';
import { roleOf, roleLabel, areasOf } from '../_lib/adminRoles.js';

// GET /api/admin/me -- who is signed in: name, role, the admin areas they
// can open (drives the sidebar) and the export permission.
export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  return Response.json({ admin: { ...admin, roleId: roleOf(admin), roleLabel: roleLabel(admin), areas: areasOf(admin) } }, { headers: { 'Cache-Control': 'no-store' } });
}
