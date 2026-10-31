import { listRequests, decideRequest, FORMATS, STATUSES } from '../_lib/mediaInterviews.js';
import { json } from '../_lib/mediaCentre.js';

// Media Centre › Interview Requests.
// GET  -- every request (new first).  POST { id, decision: approve | decline | propose | done, note?, at? }
export async function onRequestGet({ env }) {
  return json({ requests: await listRequests(env.DB), formats: FORMATS, statuses: STATUSES });
}
export async function onRequestPost({ request, env, data }) {
  const b = await request.json().catch(() => ({}));
  const r = await decideRequest(env, request, data.mc.user, String(b.id || ''), b);
  return r.ok ? json(r) : json({ error: r.error }, r.status || 400);
}
