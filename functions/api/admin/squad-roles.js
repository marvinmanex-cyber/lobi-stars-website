import { requireAdminUser } from '../_lib/adminEvents.js';
import { can } from '../_lib/adminRoles.js';
import { listRoles, renameRole, mergeRoles, setRole, reorderRoles, CATEGORIES } from '../_lib/squadRoles.js';

// Squad › Roles (only the three Super Admins: squad.approve). The list behind
// "Position at the club" in the portal. Coaching roles are shown on the Squad page.
// GET  /api/admin/squad-roles                                  -- the roles (with how many people have each), pending ones included
// POST { action: 'rename', id, name }                          -- the profiles with that role follow
// POST { action: 'merge', id, into }                           -- everyone with role id gets role `into`; id is removed
// POST { action: 'category', id, category: COACHING|CLUB_STAFF } -- on / off the Squad page at once
// POST { action: 'active', id, active }                        -- shown in the portal list or not (people keep it)
// POST { action: 'order', ids }                                -- the display order
const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });

async function guard(request, env) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return { denied };
  if (!can(admin, 'squad.approve')) return { denied: json({ error: 'Only the Super Admins can change the squad roles.' }, 403) };
  return { admin };
}
export async function onRequestGet({ request, env }) {
  const { denied } = await guard(request, env);
  if (denied) return denied;
  return json({ roles: await listRoles(env.DB), categories: CATEGORIES });
}
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await guard(request, env);
  if (denied) return denied;
  const db = env.DB, b = await request.json().catch(() => ({}));
  let r;
  if (b.action === 'rename') r = await renameRole(db, admin, b.id, b.name);
  else if (b.action === 'merge') r = await mergeRoles(db, admin, b.id, b.into);
  else if (b.action === 'category') r = await setRole(db, admin, b.id, { category: b.category });
  else if (b.action === 'active') r = await setRole(db, admin, b.id, { active: !!b.active });
  else if (b.action === 'order') r = await reorderRoles(db, admin, b.ids);
  else return json({ error: 'Unknown action' }, 400);
  return r.error ? json(r, r.status || 400) : json(r);
}
