import { signOut, clearMediaCookie, json } from '../_lib/mediaCentre.js';

// POST /api/media-centre/logout { why? } -- why: 'idle' when the page signed out after 30 quiet minutes.
export async function onRequestPost({ request, env, data }) {
  const b = await request.json().catch(() => ({}));
  await signOut(env, request, data.mc, b.why === 'idle' ? 'no activity for 30 minutes' : 'signed out');
  return json({ ok: true }, 200, { 'Set-Cookie': clearMediaCookie() });
}
