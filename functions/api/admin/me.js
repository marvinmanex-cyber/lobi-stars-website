import { requireAdminUser } from '../_lib/adminEvents.js';

// GET /api/admin/me -- who is signed in (name, role, export permission).
export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  return Response.json({ admin });
}
