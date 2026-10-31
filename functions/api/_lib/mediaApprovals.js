// Media Centre: the Super Admins' decisions (Approval Queue) and scheduled
// publishing. Each kind of content says how it is checked, published and
// unpublished (mediaKinds.js); this file runs the shared workflow.
import { logAdminAction } from './adminSession.js';
import { ensureMediaSchema, getItem, itemView, addRevision, revisions, mcLog, adminActor, SYSTEM, parseJson, KIND_LABELS } from './mediaCentre.js';
import { KINDS } from './mediaKinds.js';

const nowIso = () => new Date().toISOString();
const sectionOf = kind => KINDS[kind]?.section || kind;

/** Publishes an item now (approval, or its scheduled time). Returns { ok } or { error }. */
async function publishNow(env, r, data, by, ctx = {}) {
  const kind = KINDS[r.kind];
  if (!kind?.publish) return { error: 'This kind of content cannot be published yet.' };
  let res;
  try { res = await kind.publish(env, r, data, ctx); } catch (e) { res = { error: String(e?.message || e).slice(0, 300) }; }
  if (!res?.ok) {
    await env.DB.prepare(`UPDATE mc_items SET publish_error = ? WHERE id = ?`).bind(res?.error || 'Publishing failed.', r.id).run();
    return { error: res?.error || 'Publishing failed.' };
  }
  const at = nowIso();
  await env.DB.prepare(`UPDATE mc_items SET status = 'published', correction = NULL, live_json = ?, data_json = ?, slug = COALESCE(?, slug), published_at = COALESCE(published_at, ?),
    publish_error = NULL, decided_at = COALESCE(decided_at, ?), decided_by = COALESCE(decided_by, ?) WHERE id = ?`)
    .bind(JSON.stringify(data), JSON.stringify(data), res.slug || null, at, at, by, r.id).run();
  return { ok: true, slug: res.slug || r.slug, note: res.note || null };
}

/**
 * A Super Admin's decision on a submitted item (or an unpublish).
 * decision: approve | return | reject | unpublish. data: edited content (edit-then-approve).
 */
export async function decide(env, admin, request, id, { decision, comment = '', data = null, scheduledAt = undefined }) {
  const db = env.DB;
  await ensureMediaSchema(db);
  const r = await getItem(db, id);
  if (!r) return { error: 'Not found.', status: 404 };
  const kind = KINDS[r.kind];
  const A = adminActor(admin), by = admin.name || admin.email, at = nowIso();
  const waiting = r.status === 'submitted' || r.correction === 'submitted';
  const isCorrection = r.correction === 'submitted';
  const log = (action, details) => Promise.all([
    mcLog(db, A, action, { section: sectionOf(r.kind), itemType: r.kind, itemId: r.id, itemTitle: r.title, details, request }),
    logAdminAction(db, admin, `approval_media_${action}`, `Media Centre ${KIND_LABELS[r.kind] || r.kind} "${r.title || r.id}"${details ? `: ${details}` : ''}`),
  ]);
  comment = String(comment || '').trim().slice(0, 2000);

  if (decision === 'unpublish') {
    if (r.status !== 'published' && r.status !== 'scheduled') return { error: 'Only published or scheduled content can be unpublished.' };
    if (r.status === 'published' && kind?.unpublish) {
      const res = await kind.unpublish(env, r).catch(e => ({ error: String(e?.message || e) }));
      if (!res?.ok) return { error: res?.error || 'Could not unpublish.' };
    }
    await db.prepare(`UPDATE mc_items SET status = 'unpublished', correction = NULL, unpublished_at = ?, decided_at = ?, decided_by = ?, comment = ? WHERE id = ?`).bind(at, at, by, comment || null, r.id).run();
    await addRevision(db, r, 'unpublished', r.live_json || r.data_json, by, comment || null);
    await log('unpublish', comment);
    return { ok: true };
  }
  if (!waiting) return { error: 'This is not waiting for approval (someone may have decided already).' };
  if ((decision === 'return' || decision === 'reject') && comment.length < 3) return { error: 'Write a short comment for the writer.' };

  if (decision === 'return') {
    await db.prepare(`UPDATE mc_items SET ${isCorrection ? "correction = 'returned'" : "status = 'returned'"}, comment = ?, decided_at = ?, decided_by = ? WHERE id = ?`).bind(comment, at, by, r.id).run();
    await addRevision(db, r, 'returned', r.data_json, by, comment);
    await log('return', comment);
    return { ok: true };
  }
  if (decision === 'reject') {
    if (isCorrection) {
      // The correction is dropped; the live version stays and becomes the working copy again.
      await db.prepare(`UPDATE mc_items SET correction = NULL, data_json = COALESCE(live_json, data_json), comment = ?, decided_at = ?, decided_by = ? WHERE id = ?`).bind(comment, at, by, r.id).run();
    } else {
      await db.prepare(`UPDATE mc_items SET status = 'rejected', comment = ?, decided_at = ?, decided_by = ? WHERE id = ?`).bind(comment, at, by, r.id).run();
    }
    await addRevision(db, r, 'rejected', r.data_json, by, comment);
    await log('reject', comment);
    return { ok: true };
  }
  if (decision !== 'approve') return { error: 'Unknown decision.' };

  // Edit-then-approve: the Super Admin's edited version replaces the working copy.
  let content = parseJson(r.data_json, {});
  if (data && typeof data === 'object') {
    const checked = kind?.normalise ? await kind.normalise(data, { admin: true }) : { value: data };
    if (checked.error) return { error: checked.error };
    content = checked.value;
    await db.prepare(`UPDATE mc_items SET data_json = ?, title = ? WHERE id = ?`).bind(JSON.stringify(content), (kind?.titleOf?.(content) || r.title || '').slice(0, 200), r.id).run();
    await addRevision(db, r, 'edited_by_admin', content, by);
  }
  const problem = kind?.validate ? kind.validate(content, { admin: true }) : null;
  if (problem) return { error: problem };
  const when = scheduledAt !== undefined ? scheduledAt : r.scheduled_at;
  const fresh = { ...r, data_json: JSON.stringify(content) };
  if (kind?.schedulable && when && Date.parse(when) > Date.now() + 60e3 && !isCorrection) {
    await db.prepare(`UPDATE mc_items SET status = 'scheduled', correction = NULL, live_json = ?, scheduled_at = ?, decided_at = ?, decided_by = ?, comment = NULL WHERE id = ?`)
      .bind(JSON.stringify(content), new Date(when).toISOString(), at, by, r.id).run();
    await addRevision(db, fresh, 'approved', content, by, `Scheduled for ${when}`);
    await log('approve', `Scheduled for ${new Date(when).toISOString()}`);
    return { ok: true, scheduled: true };
  }
  const res = await publishNow(env, fresh, content, by, { admin, correction: isCorrection });
  if (res.error) { await log('publish_failed', res.error); return { error: `Approved, but publishing failed: ${res.error}` }; }
  await db.prepare(`UPDATE mc_items SET decided_at = ?, decided_by = ?, comment = NULL WHERE id = ?`).bind(at, by, r.id).run();
  await addRevision(db, fresh, 'approved', content, by, isCorrection ? 'Correction published' : null);
  await log('approve', [isCorrection ? 'Correction published' : 'Published', res.note].filter(Boolean).join('; '));
  return { ok: true, published: true, slug: res.slug, note: res.note };
}

/** The every-minute job: publishes scheduled items whose time has come. */
export async function publishDue(env) {
  const db = env.DB;
  await ensureMediaSchema(db);
  const due = (await db.prepare(`SELECT * FROM mc_items WHERE status = 'scheduled' AND scheduled_at <= ? ORDER BY scheduled_at LIMIT 3`).bind(nowIso()).all()).results;
  let done = 0;
  for (const r of due) {
    const data = parseJson(r.live_json || r.data_json, {});
    const res = await publishNow(env, r, data, r.decided_by || 'schedule', { scheduled: true });
    await mcLog(db, SYSTEM, res.ok ? 'publish_scheduled' : 'publish_failed', { section: sectionOf(r.kind), itemType: r.kind, itemId: r.id, itemTitle: r.title, details: res.error || null });
    if (res.ok) done++;
  }
  return { published: done };
}

/** One item with its revisions, for the queue's preview and compare. */
export async function itemDetail(db, id) {
  const r = await getItem(db, id);
  if (!r) return null;
  const kind = KINDS[r.kind];
  const v = itemView(r);
  return { item: v, fields: kind?.adminFields || null, revisions: await revisions(db, id), previewHtml: kind?.previewHtml ? kind.previewHtml(v.data) : null, livePreviewHtml: v.live && kind?.previewHtml ? kind.previewHtml(v.live) : null };
}
