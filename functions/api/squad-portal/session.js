import { requirePortal, portalJson, IDLE_MS } from '../_lib/squadPortal.js';

// GET  /api/squad-portal/session -- who is signed in, the CSRF token for changes, the current season.
// POST /api/squad-portal/session -- "Stay signed in" (keeps the session alive).
export async function onRequestGet({ request, env }) {
  const { session, denied } = await requirePortal(request, env);
  if (denied) return denied;
  return portalJson({ name: session.name, csrf: session.csrf, season: session.season, device: session.device, since: session.since, idleMinutes: IDLE_MS / 60000 });
}
export async function onRequestPost({ request, env }) {
  const { session, denied } = await requirePortal(request, env, { write: true });
  if (denied) return denied;
  return portalJson({ ok: true, name: session.name });
}
