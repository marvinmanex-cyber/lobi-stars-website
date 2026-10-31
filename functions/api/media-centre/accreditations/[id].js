import { ensureAccreditationSchema, view, decideAccreditation } from '../../_lib/mediaAccreditation.js';
import { json } from '../../_lib/mediaCentre.js';

// GET  /api/media-centre/accreditations/:id -- one request (photo and document links).
// POST /api/media-centre/accreditations/:id { decision: approve | reject | info, zone?, reason?, message? }
// Any Media Centre user may decide (the one exception to Super Admin approval).
export async function onRequestGet({ env, params }) {
  await ensureAccreditationSchema(env.DB);
  const r = await env.DB.prepare(`SELECT * FROM mc_accreditations WHERE id = ?`).bind(params.id).first();
  return r ? json({ request: view(r) }) : json({ error: 'Not found.' }, 404);
}
export async function onRequestPost({ request, env, params, data }) {
  const b = await request.json().catch(() => ({}));
  const r = await decideAccreditation(env, request, data.mc.user, params.id, b);
  return r.ok ? json(r) : json({ error: r.error }, r.status || 400);
}
