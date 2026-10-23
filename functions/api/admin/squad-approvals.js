import { requireAdminUser } from '../_lib/adminEvents.js';
import { can } from '../_lib/adminRoles.js';
import { queue, detail, approveProfile, approveMany, requestChanges, decideRequest, ensureApprovalSchema } from '../_lib/squadApprovals.js';

// Squad › Approvals (only the three Super Admins: squad.approve, checked here and by the route rules).
// GET  /api/admin/squad-approvals              -- everything waiting (new profiles, changes, requests), oldest first
// GET  /api/admin/squad-approvals?id=<profile> -- one item: before / after with the changed fields, photos, preview link
// POST { action: 'approve', id }                -- goes live at once (the website shows it within about 10 seconds)
// POST { action: 'approve_many', ids }          -- several NEW profiles at once (confirmed on the page)
// POST { action: 'request_changes', id, note }  -- back to the portal as "Changes requested" with the note
// POST { action: 'request', requestId, decision: 'approve' | 'reject', note } -- left the club, loan, delete, restore, new role
const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });

async function guard(request, env) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return { denied };
  if (!can(admin, 'squad.approve')) return { denied: json({ error: 'Only the Super Admins can approve squad profiles.' }, 403) };
  await ensureApprovalSchema(env.DB);
  return { admin };
}

export async function onRequestGet({ request, env }) {
  const { denied } = await guard(request, env);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get('id');
  if (id) { const d = await detail(env, id); return d.error ? json(d, d.status) : json(d); }
  return json({ items: await queue(env) });
}

export async function onRequestPost({ request, env, waitUntil }) {
  const { admin, denied } = await guard(request, env);
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  let r;
  if (b.action === 'approve') r = await approveProfile(env, admin, String(b.id || ''), { waitUntil });
  else if (b.action === 'approve_many') r = { ok: true, ...(await approveMany(env, admin, Array.isArray(b.ids) ? b.ids.map(String) : [], { waitUntil })) };
  else if (b.action === 'request_changes') r = await requestChanges(env, admin, String(b.id || ''), b.note);
  else if (b.action === 'request') r = await decideRequest(env, admin, b.requestId, b.decision === 'approve' ? 'approve' : 'reject', b.note);
  else return json({ error: 'Unknown action' }, 400);
  return r.error ? json(r, r.status || 400) : json(r);
}
