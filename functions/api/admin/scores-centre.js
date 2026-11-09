// Admin › Matchday › Scores Update Centre (Super Admins only).
//   GET  -> { sessions (last 7 days, who is online), refused (wrong codes), code (where it comes from) }
//   POST { action: 'signout-all' } | { action: 'signout', id } | { action: 'code', code }
// Every change goes in the activity log with the admin's name and time. The code itself is never
// shown or logged; only a hash is kept.
import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { adminOverview, signOutSessions, changeCode } from '../_lib/scoresCentre.js';

const isSuper = a => a.role === 'super_admin' || a.role === 'owner';
const no = () => Response.json({ error: 'Only a Super Admin can manage the Scores Update Centre.' }, { status: 403 });
const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });

export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  if (!isSuper(admin)) return no();
  return json(await adminOverview(env));
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  if (!isSuper(admin)) return no();
  const b = await request.json().catch(() => ({}));
  if (b.action === 'signout-all') {
    const r = await signOutSessions(env);
    await logAdminAction(env.DB, admin, 'scores_centre', `Scores Update Centre: signed everyone out (${r.ended})`);
    return json(r);
  }
  if (b.action === 'signout') {
    const r = await signOutSessions(env, b.id);
    await logAdminAction(env.DB, admin, 'scores_centre', 'Scores Update Centre: signed one person out');
    return json(r);
  }
  if (b.action === 'code') {
    const r = await changeCode(env, admin, String(b.code || '').trim());
    if (r.error) return json(r, 400);
    let ended = 0;
    if (b.signOutAll) ended = (await signOutSessions(env)).ended;
    await logAdminAction(env.DB, admin, 'scores_centre', `Scores Update Centre: access code changed${b.signOutAll ? ` and everyone signed out (${ended})` : ''}`);
    return json({ ok: true, ended });
  }
  return json({ error: 'Unknown action' }, 400);
}
