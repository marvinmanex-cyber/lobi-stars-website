import { unlockDesk, lockDesk, json } from '../_lib/mediaCentre.js';

// POST /api/media-centre/desk { code }  -- unlock the Approval Queue and the Media Inbox for this session.
// DELETE /api/media-centre/desk         -- lock them again.
export async function onRequestPost({ request, env, data }) {
  const b = await request.json().catch(() => ({}));
  const r = await unlockDesk(env, request, data.mc, String(b.code || ''));
  return r.ok ? json(r) : json({ error: r.error }, r.status || 400);
}
export async function onRequestDelete({ request, env, data }) {
  return json(await lockDesk(env, request, data.mc));
}
