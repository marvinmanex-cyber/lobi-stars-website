import { getMediaSession, IDLE_MS, json } from '../_lib/mediaCentre.js';

// GET /api/media-centre/session -- who is signed in (or { signedIn: false }).
// X-Activity: 0 checks without counting as activity (the idle timer keeps running).
export async function onRequestGet({ request, env }) {
  const s = await getMediaSession(request, env, { touch: request.headers.get('X-Activity') !== '0' });
  if (!s) return json({ signedIn: false, idleMs: IDLE_MS });
  return json({ signedIn: true, user: s.user, csrf: s.csrf, idleMs: IDLE_MS, lastSeen: s.lastSeen });
}
