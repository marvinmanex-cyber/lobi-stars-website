import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { listSuggestions, decideSuggestion } from '../_lib/squadNews.js';

// Squad: Tag suggestions (Super Admins and staff who edit news). Player and
// staff names found in published stories that aren't tagged with them.
// GET [?status=tagged|dismissed] -- the list.  POST { id, decision: 'tag' | 'dismiss' }
const J = (d, s = 200) => Response.json(d, { status: s, headers: { 'Cache-Control': 'no-store' } });
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const status = ['tagged', 'dismissed'].includes(new URL(request.url).searchParams.get('status')) ? new URL(request.url).searchParams.get('status') : 'pending';
  return J({ status, suggestions: await listSuggestions(env.DB, status) });
}
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  const r = await decideSuggestion(env, admin, b.id, b.decision);
  if (r.ok) await logAdminAction(env.DB, admin, b.decision === 'tag' ? 'squad_tag_story' : 'squad_tag_dismiss', `${admin.name || admin.email} ${b.decision === 'tag' ? 'tagged a story from' : 'dismissed'} tag suggestion ${b.id}`);
  return r.ok ? J(r) : J({ error: r.error }, r.status || 400);
}
