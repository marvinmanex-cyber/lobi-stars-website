import { changePassword, json } from '../_lib/mediaCentre.js';

// POST /api/media-centre/password { current, password } -- required after a temporary password; allowed any time.
export async function onRequestPost({ request, env, data }) {
  const b = await request.json().catch(() => ({}));
  const r = await changePassword(env, request, data.mc, b);
  return r.ok ? json({ ok: true }) : json({ error: r.error }, 400);
}
