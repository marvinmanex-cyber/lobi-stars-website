import { requirePortal, portalJson, portalActor, IDLE_MS } from '../_lib/squadPortal.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { pickList } from '../_lib/squadRoles.js';

// GET  /api/squad-portal/session -- who is signed in, the CSRF token for changes, the current season, the roles list.
// POST /api/squad-portal/session -- "Stay signed in" (keeps the session alive). With
//   { report: 'save_failed' | 'photo_failed' | 'unsynced', profile, detail, waiting, minutes }
//   the portal tells the club that a change was refused or has been waiting on the
//   device; it goes to the Activity Log (never the answers themselves) and Website Health.
const REPORTS = { save_failed: 'squad_save_failed', photo_failed: 'squad_photo_failed', unsynced: 'squad_save_unsynced' };
export async function onRequestGet({ request, env }) {
  const { session, denied } = await requirePortal(request, env);
  if (denied) return denied;
  const roles = await pickList(env.DB).catch(() => []);
  return portalJson({ name: session.name, csrf: session.csrf, season: session.season, device: session.device, since: session.since, idleMinutes: IDLE_MS / 60000, roles });
}
export async function onRequestPost({ request, env }) {
  const { session, denied } = await requirePortal(request, env, { write: true });
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const action = REPORTS[body?.report];
  if (action) {
    const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').slice(0, n);
    let who = 'a profile';
    if (/^sp_[a-z0-9]+$/.test(String(body.profile || ''))) {
      const p = await env.DB.prepare('SELECT COALESCE(public_name, display_name) AS name, type FROM squad_profiles WHERE id = ?').bind(body.profile).first().catch(() => null);
      if (p) who = p.name || (p.type === 'staff' ? 'a staff member' : 'a player');
    }
    const text = body.report === 'unsynced'
      ? `${session.name}: ${Number(body.waiting) || 0} change(s) to ${who} waiting on their device for ${Number(body.minutes) || 0} minutes while online`
      : `${session.name}: ${body.report === 'photo_failed' ? 'a photo or recording' : 'a change'} for ${who} could not be saved (${clip(body.detail, 160) || 'refused'})`;
    await logAdminAction(env.DB, portalActor(session), action, text);
  }
  return portalJson({ ok: true, name: session.name });
}
