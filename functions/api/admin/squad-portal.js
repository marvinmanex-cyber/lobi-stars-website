import { requireAdminUser } from '../_lib/adminEvents.js';
import { can } from '../_lib/adminRoles.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { getPortalSettings, setPortalSetting, resetPortalPassword, openSessions, signOutAll, unseenDevices, ensurePortalSchema, portalLink, portalPath } from '../_lib/squadPortal.js';

// Settings › Squad & Staff Data Portal (only the three Super Admins: squad.portal.manage).
// GET                                         -- link, username, on/off, season, open sessions, new devices
// POST { action: 'username', username }
// POST { action: 'new_password' }             -- returns the new password ONCE; signs out every portal session
// POST { action: 'enabled', enabled }         -- open / close the portal
// POST { action: 'season', season }           -- e.g. "2026/27"
// POST { action: 'sign_out_all' } | { action: 'sign_out', id }
// POST { action: 'devices_seen' }             -- clears the "new device" bell
const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });

async function guard(request, env) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return { denied };
  if (!can(admin, 'squad.portal.manage')) return { denied: json({ error: 'Only the three Super Admins can manage the Squad & Staff Data Portal.' }, 403) };
  return { admin };
}

async function view(env, request) {
  const db = env.DB;
  const s = await getPortalSettings(db);
  const devices = (await db.prepare(`SELECT id, device, first_name, first_seen, last_seen, seen_by_admin FROM squad_portal_devices ORDER BY first_seen DESC LIMIT 30`).all()).results;
  return {
    link: portalLink(env, new URL(request.url).origin), path: portalPath(env),
    username: s.username, hasPassword: !!s.password_hash, enabled: s.enabled === '1', season: s.season,
    lockedUntil: s.locked_until && Date.parse(s.locked_until) > Date.now() ? s.locked_until : null,
    sessions: await openSessions(db), devices, unseen: (await unseenDevices(db)).length,
  };
}

export async function onRequestGet({ request, env }) {
  const { denied } = await guard(request, env);
  if (denied) return denied;
  await ensurePortalSchema(env.DB);
  return json(await view(env, request));
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await guard(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensurePortalSchema(db);
  const b = await request.json().catch(() => ({}));
  const out = {};
  if (b.action === 'username') {
    const u = String(b.username || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{3,31}$/.test(u)) return json({ error: 'The username needs 4 to 32 letters, numbers, dots, dashes or underscores.' }, 400);
    await setPortalSetting(db, 'username', u, admin.name);
    await logAdminAction(db, admin, 'squad_portal_username', `Squad Data Portal username changed to "${u}"`);
  } else if (b.action === 'new_password') {
    out.password = await resetPortalPassword(env, admin);
  } else if (b.action === 'enabled') {
    await setPortalSetting(db, 'enabled', b.enabled ? '1' : '0', admin.name);
    if (!b.enabled) await signOutAll(env, admin, 'portal closed');
    await logAdminAction(db, admin, 'squad_portal_enabled', `Squad Data Portal ${b.enabled ? 'opened' : 'closed'}`);
  } else if (b.action === 'season') {
    const season = String(b.season || '').trim();
    if (!/^20\d\d\/\d\d$/.test(season)) return json({ error: 'Write the season like 2026/27.' }, 400);
    await setPortalSetting(db, 'season', season, admin.name);
    await logAdminAction(db, admin, 'squad_portal_season', `Squad Data Portal season set to ${season}`);
  } else if (b.action === 'sign_out_all') {
    const n = await signOutAll(env, admin);
    await logAdminAction(db, admin, 'squad_portal_signout_all', `Signed out ${n} Squad Data Portal session${n === 1 ? '' : 's'}`);
  } else if (b.action === 'sign_out') {
    await db.prepare(`UPDATE squad_portal_sessions SET ended_at = ?, ended_why = 'signed out by a Super Admin' WHERE id = ? AND ended_at IS NULL`).bind(new Date().toISOString(), String(b.id || '')).run();
    await logAdminAction(db, admin, 'squad_portal_signout', 'Signed out one Squad Data Portal session');
  } else if (b.action === 'devices_seen') {
    await db.prepare(`UPDATE squad_portal_devices SET seen_by_admin = 1 WHERE seen_by_admin = 0`).run();
  } else return json({ error: 'Unknown action' }, 400);
  return json({ ok: true, ...out, ...(await view(env, request)) });
}
