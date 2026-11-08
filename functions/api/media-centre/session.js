import { getMediaSession, IDLE_MS, json, renewMediaCookie } from '../_lib/mediaCentre.js';

// GET /api/media-centre/session -- who is signed in (or { signedIn: false }).
// X-Activity: 0 checks without counting as activity (the idle timer keeps running).
export async function onRequestGet({ request, env }) {
  const s = await getMediaSession(request, env, { touch: request.headers.get('X-Activity') !== '0' });
  if (!s) return json({ signedIn: false, idleMs: IDLE_MS });
  // Brings an older sign-in's cookie up to date (SameSite=Lax), so links from other apps keep you signed in.
  const renewed = renewMediaCookie(request);
  return json({ signedIn: true, user: s.user, csrf: s.csrf, idleMs: IDLE_MS, lastSeen: s.lastSeen }, 200, renewed ? { 'Set-Cookie': renewed } : {});
}
