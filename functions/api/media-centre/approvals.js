import { queue, json } from '../_lib/mediaCentre.js';
import { decide, itemDetail } from '../_lib/mediaApprovals.js';

// The Media Centre Approval Queue for the media approver (signed in with the
// approval password). Approve, return (with a comment) or reject; recorded as
// "Media approver". The Super Admins also approve in the admin.
// GET ?id=<item> -- one item with its preview.   GET -- everything waiting.
// POST { id, decision: approve | return | reject, comment? }
const MEDIA_APPROVER = { id: 'media-approver', name: 'Media approver', email: '', mediaApprover: true };
export async function onRequestGet({ request, env, data }) {
  if (!data.mc.user.approver && !data.mc.user.admin) return json({ error: 'Only the media approver can open this.' }, 403);
  const id = new URL(request.url).searchParams.get('id');
  if (id) {
    const d = await itemDetail(env.DB, id);
    if (!d) return json({ error: 'Not found.' }, 404);
    return json({ ...d, item: { ...d.item, decidedBy: null }, revisions: undefined });
  }
  return json({ items: (await queue(env.DB)).map(i => ({ ...i, decidedBy: null })) });
}
export async function onRequestPost({ request, env, data }) {
  if (!data.mc.user.approver && !data.mc.user.admin) return json({ error: 'Only the media approver can do this.' }, 403);
  const b = await request.json().catch(() => ({}));
  if (!['approve', 'return', 'reject'].includes(b.decision)) return json({ error: 'Choose approve, return or reject.' }, 400);
  const u = data.mc.user;
  const who = u.admin ? { id: u.id.slice(6), name: u.fullName, email: u.loginId } : MEDIA_APPROVER;
  const r = await decide(env, who, request, String(b.id || ''), { decision: b.decision, comment: String(b.comment || '').slice(0, 2000) });
  return r.error ? json({ error: r.error }, r.status || 400) : json(r);
}
