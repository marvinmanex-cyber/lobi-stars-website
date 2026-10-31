import { requireAdminUser } from '../../_lib/adminEvents.js';
import { queue, json } from '../../_lib/mediaCentre.js';
import { decide, itemDetail } from '../../_lib/mediaApprovals.js';

// The Media Centre Approval Queue (Super Admins).
// GET  ?id=<item>  -- one item: preview, the live version, revisions (compare).
// GET              -- everything submitted from the Media Centre, newest first.
// POST { id, decision: approve | return | reject | unpublish, comment?, data? (edit-then-approve), scheduledAt? }
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get('id');
  if (id) {
    const d = await itemDetail(env.DB, id);
    return d ? json(d) : json({ error: 'Not found.' }, 404);
  }
  const published = (await env.DB.prepare(`SELECT id, kind, title, status, published_at, scheduled_at, slug FROM mc_items WHERE status IN ('published', 'scheduled') ORDER BY COALESCE(published_at, scheduled_at) DESC LIMIT 60`).all()).results;
  return json({ items: await queue(env.DB), published });
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  const r = await decide(env, admin, request, String(b.id || ''), b);
  return r.error ? json({ error: r.error }, r.status || 400) : json(r);
}
