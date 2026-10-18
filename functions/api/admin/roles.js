import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { PERMISSIONS, ALL_PERMISSIONS, ROLE_DEFAULTS, rolePermissions, roleChanged, saveRole, loadRoles } from '../_lib/adminRoles.js';

const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });
const labelOf = id => PERMISSIONS.flatMap(g => g.items).find(([p]) => p === id)?.[1] || id;

// GET /api/admin/roles -- every role with what it includes now, its default,
// and the list of permissions (Staff › Roles; Super Admin only).
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env, { ownerOnly: true });
  if (denied) return denied;
  await loadRoles(env.DB, { force: true });
  const roles = Object.entries(ROLE_DEFAULTS).map(([id, r]) => ({
    id, label: r.label, job: r.job || '', about: r.about, locked: !!r.locked, legacy: !!r.legacy, readOnly: !!r.readOnly,
    permissions: rolePermissions(id), defaults: r.locked ? ALL_PERMISSIONS : r.permissions, changed: roleChanged(id),
  }));
  return json({ permissions: PERMISSIONS.map(g => ({ group: g.group, items: g.items.map(([id, label]) => ({ id, label })) })), roles });
}

// PUT /api/admin/roles { id, permissions: [...] } or { id, reset: true } -- change
// what a role includes (the Super Admin role always has everything). Logged.
export async function onRequestPut({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env, { ownerOnly: true });
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  const def = ROLE_DEFAULTS[b.id];
  if (!def) return json({ error: 'Unknown role.' }, 404);
  if (def.locked) return json({ error: 'The Super Admin role always includes everything.' }, 400);
  await loadRoles(env.DB, { force: true });
  const before = rolePermissions(b.id);
  let next = null;
  if (!b.reset) {
    if (!Array.isArray(b.permissions)) return json({ error: 'Send the list of permissions.' }, 400);
    const unknown = b.permissions.filter(p => !ALL_PERMISSIONS.includes(p));
    if (unknown.length) return json({ error: `Unknown permission: ${unknown.join(', ')}` }, 400);
    // Managing staff and roles stays with Super Admins, so nobody can give themselves more access.
    if (b.permissions.includes('staff.manage')) return json({ error: 'Only the Super Admin role manages staff and roles.' }, 400);
    next = ALL_PERMISSIONS.filter(p => b.permissions.includes(p));
  }
  await saveRole(env.DB, b.id, next, admin.name);
  const after = rolePermissions(b.id);
  const added = after.filter(p => !before.includes(p)), removed = before.filter(p => !after.includes(p));
  const detail = [b.reset && 'back to the default', added.length && `added: ${added.map(labelOf).join('; ')}`, removed.length && `removed: ${removed.map(labelOf).join('; ')}`].filter(Boolean).join(' · ') || 'no change';
  await logAdminAction(env.DB, admin, 'role_changed', `${def.label}: ${detail}`);
  return json({ ok: true, permissions: after, changed: roleChanged(b.id) });
}
