import { ensureAccreditationSchema, view, decideAccreditation, revoke, restore, eventById } from '../../_lib/mediaAccreditation.js';
import { matchSettings, sendApprovalTo } from '../../_lib/accreditationCards.js';
import { json, mcLog, mediaActor } from '../../_lib/mediaCentre.js';

// GET  /api/media-centre/accreditations/:id -- one request.
// POST /api/media-centre/accreditations/:id
//   { decision: approve, zones: [1..5] } | { decision: reject, reason } | { decision: info, message }
//   { action: 'revoke', reason? } | { action: 'restore' } | { action: 'resend' } (the approval email again)
export async function onRequestGet({ env, params }) {
  await ensureAccreditationSchema(env.DB);
  const r = await env.DB.prepare(`SELECT * FROM mc_accreditations WHERE id = ?`).bind(params.id).first();
  return r ? json({ request: view(r) }) : json({ error: 'Not found.' }, 404);
}
export async function onRequestPost({ request, env, params, data }) {
  const b = await request.json().catch(() => ({}));
  const user = data.mc.user;
  if (b.action === 'revoke') { const r = await revoke(env, request, { id: user.id, name: user.fullName }, params.id, b.reason); return r.ok ? json(r) : json({ error: r.error }, 400); }
  if (b.action === 'restore') { const r = await restore(env, request, user, params.id); return r.ok ? json(r) : json({ error: r.error }, 400); }
  if (b.action === 'resend') {
    await ensureAccreditationSchema(env.DB);
    const r = await env.DB.prepare(`SELECT * FROM mc_accreditations WHERE id = ?`).bind(params.id).first();
    if (!r || r.status !== 'approved') return json({ error: 'Only approved applicants can be emailed.' }, 400);
    const e = await eventById(env.DB, r.event_id); const ms = e && await matchSettings(env.DB, e);
    if (!ms?.approverName) return json({ error: 'Add the approving officer in Match settings first.' }, 400);
    let ok = false;
    try { ok = await sendApprovalTo(env, r, e, ms); } catch (err) { console.error('[accreditation] resend', err); }
    if (!ok) return json({ error: 'The email could not be sent (is the email service set up?).' }, 502);
    await mcLog(env.DB, mediaActor(user), 'approval_email', { section: 'accreditation', itemType: 'accreditation', itemId: r.id, itemTitle: `${r.full_name} (${r.number})`, details: 'Resent', request });
    return json({ ok: true });
  }
  const r = await decideAccreditation(env, request, user, params.id, b);
  return r.ok ? json(r) : json({ error: r.error }, r.status || 400);
}
