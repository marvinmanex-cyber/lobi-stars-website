import { ensureAccreditationSchema, view, decideAccreditation, revoke, restore, eventById } from '../../_lib/mediaAccreditation.js';
import { matchSettings, sendApprovalTo } from '../../_lib/accreditationCards.js';
import { json, mcLog, mediaActor } from '../../_lib/mediaCentre.js';

// GET  /api/media-centre/accreditations/:id -- one request.
// POST /api/media-centre/accreditations/:id
//   { decision: approve, zones: [1..5] } | { decision: reject, reason } | { decision: info, message }
//   { action: 'revoke', reason? } | { action: 'restore' } | { action: 'resend' } (the approval email again)
// GET ?review=1 -- the review page: the full application, its ID document type, the match,
// earlier applications by the same email; marks it as reviewed (needed before approve / reject).
export async function onRequestGet({ request, env, params, data }) {
  const db = env.DB;
  await ensureAccreditationSchema(db);
  let r = await db.prepare(`SELECT * FROM mc_accreditations WHERE id = ?`).bind(params.id).first();
  if (!r) return json({ error: 'Not found.' }, 404);
  if (new URL(request.url).searchParams.get('review') !== '1') return json({ request: view(r) });
  const user = data.mc.user;
  if (['pending', 'info'].includes(r.status)) {
    await db.prepare(`UPDATE mc_accreditations SET reviewed_at = ?, reviewed_by = ? WHERE id = ?`).bind(new Date().toISOString(), user.fullName, r.id).run();
    if (!r.reviewed_at) await mcLog(db, mediaActor(user), 'review', { section: 'accreditation', itemType: 'accreditation', itemId: r.id, itemTitle: r.full_name, request });
    r = await db.prepare(`SELECT * FROM mc_accreditations WHERE id = ?`).bind(params.id).first();
  }
  const e = await eventById(db, r.event_id);
  const doc = r.press_doc_id ? await db.prepare(`SELECT mime, name, bytes FROM mc_files WHERE id = ?`).bind(r.press_doc_id).first() : null;
  const earlier = (await db.prepare(`SELECT id, event_id, status, number, created_at FROM mc_accreditations WHERE email = ? AND id <> ? ORDER BY created_at DESC LIMIT 20`).bind(r.email, r.id).all()).results;
  const labels = {};
  for (const x of earlier) if (!labels[x.event_id]) { const ev = await eventById(db, x.event_id); labels[x.event_id] = ev ? `${ev.home_team} v ${ev.away_team}` : 'Past match'; }
  const queue = (await db.prepare(`SELECT id FROM mc_accreditations WHERE event_id = ? AND status IN ('pending', 'info') ORDER BY created_at`).bind(r.event_id).all()).results.map(x => x.id);
  const press = await db.prepare(`SELECT subscribed FROM mc_contacts WHERE email = ?`).bind(r.email).first().catch(() => null);
  return json({ request: view(r), match: e ? { id: e.id, label: `${e.home_team} v ${e.away_team}`, date: e.event_date } : null,
    doc: doc ? { mime: doc.mime, name: doc.name, bytes: doc.bytes } : null, pressList: !!press?.subscribed,
    earlier: earlier.map(x => ({ id: x.id, match: labels[x.event_id], status: x.status, number: x.number, createdAt: x.created_at })), queue });
}
export async function onRequestPost({ request, env, params, data }) {
  const b = await request.json().catch(() => ({}));
  const user = data.mc.user;
  if (b.action === 'delete') {
    // Super Admins only: remove an application (e.g. tests). Its number is never reused.
    if (!user.admin) return json({ error: 'Only Super Admins can delete applications.' }, 403);
    await ensureAccreditationSchema(env.DB);
    const r = await env.DB.prepare(`SELECT * FROM mc_accreditations WHERE id = ?`).bind(params.id).first();
    if (!r) return json({ error: 'Not found.' }, 404);
    await env.DB.prepare(`DELETE FROM mc_accreditations WHERE id = ?`).bind(r.id).run();
    // The press list's "matches applied" for this email.
    await env.DB.prepare(`UPDATE mc_contacts SET applications_count = (SELECT COUNT(DISTINCT event_id) FROM mc_accreditations WHERE email = ?) WHERE email = ?`).bind(r.email, r.email).run().catch(() => {});
    await mcLog(env.DB, mediaActor(user), 'delete', { section: 'accreditation', itemType: 'accreditation', itemId: r.id, itemTitle: `${r.full_name}${r.number ? ` (${r.number})` : ''}`, details: `Deleted (${r.status})`, request });
    return json({ ok: true });
  }
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
