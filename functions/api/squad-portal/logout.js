import { getPortalSession, signOut, clearPortalCookie, portalJson } from '../_lib/squadPortal.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { portalActor } from '../_lib/squadPortal.js';

// POST /api/squad-portal/logout { why? } -- sign out of the portal ("no activity" when the page timed out).
export async function onRequestPost({ request, env }) {
  const s = await getPortalSession(request, env, { touch: false });
  const b = await request.json().catch(() => ({}));
  if (s) {
    const why = b.why === 'idle' ? 'no activity for 60 minutes' : 'signed out';
    await signOut(env, s, why);
    await logAdminAction(env.DB, portalActor(s), 'squad_portal_signout', `${s.name} signed out of the Squad Data Portal (${why})`);
  }
  return portalJson({ ok: true }, 200, { 'Set-Cookie': clearPortalCookie() });
}
