import { requireAdminUser } from '../../_lib/adminEvents.js';
import { listUsers, createUser, updateUser, activityList, json, sxSettings } from '../../_lib/statsCentre.js';
const migration = async db => { try { return JSON.parse((await sxSettings(db)).lineup_migration || 'null'); } catch { return null; } };

// Super Admins (permission stats.centre.manage, see adminRoles.js): Statistics Center accounts and the activity log.
// GET  -- every statistician and the latest activity.
// POST { action: 'create', loginId, fullName, password, canPublish }
//      { action: 'reset_password' | 'full_name' | 'disable' | 'enable' | 'publish_on' | 'publish_off' | 'unlock' | 'sign_out', id, ... }
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  return json({ users: await listUsers(env.DB), activity: await activityList(env.DB, { limit: 200 }), migration: await migration(env.DB) });
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  const r = b.action === 'create' ? await createUser(env, admin, request, b) : await updateUser(env, admin, request, String(b.id || ''), b);
  return r.ok ? json({ ok: true, id: r.id, users: await listUsers(env.DB), activity: await activityList(env.DB, { limit: 200 }) }) : json({ error: r.error }, 400);
}
