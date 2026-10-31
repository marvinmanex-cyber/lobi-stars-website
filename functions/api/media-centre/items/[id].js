import { getItem, itemView, editable, saveItem, submitItem, revisions, mcLog, mediaActor, json, oneLine } from '../../_lib/mediaCentre.js';
import { KINDS } from '../../_lib/mediaKinds.js';

// GET  /api/media-centre/items/:id -- the item, its history and whether it can be changed.
// PUT  /api/media-centre/items/:id { data, ref } -- save (autosave). Published items: a correction (the live version stays).
// POST /api/media-centre/items/:id { action: submit | withdraw | delete_draft, scheduledAt? }
export async function onRequestGet({ env, params }) {
  const r = await getItem(env.DB, params.id);
  if (!r || KINDS[r.kind]?.mediaCreate === false) return json({ error: 'Not found.' }, 404);
  return json({ item: itemView(r), editable: editable(r), revisions: (await revisions(env.DB, r.id)).map(({ data, ...x }) => x) });
}

export async function onRequestPut({ request, env, params, data }) {
  const r = await getItem(env.DB, params.id);
  if (!r) return json({ error: 'Not found.' }, 404);
  const kind = KINDS[r.kind];
  const b = await request.json().catch(() => ({}));
  const checked = kind?.normalise ? kind.normalise(b.data || {}, { user: data.mc.user }) : { value: b.data || {} };
  if (checked.error) return json({ error: checked.error }, 400);
  const title = kind?.titleOf ? kind.titleOf(checked.value) : r.title;
  const res = await saveItem(env.DB, data.mc.user, r, { title, data: checked.value, ref: b.ref ? oneLine(b.ref, 80) : null });
  if (res.error) return json({ error: res.error }, 409);
  // Autosaves are frequent: log an edit at most once per 10 minutes per item.
  if (!r.updated_at || Date.now() - Date.parse(r.updated_at) > 10 * 60e3 || r.updated_by_name !== data.mc.user.fullName) {
    await mcLog(env.DB, mediaActor(data.mc.user), 'edit', { section: kind?.section, itemType: r.kind, itemId: r.id, itemTitle: title, details: res.correction ? 'Correction to published content' : null, request });
  }
  return json({ ok: true, savedAt: res.at, correction: res.correction });
}

export async function onRequestPost({ request, env, params, data }) {
  const r = await getItem(env.DB, params.id);
  if (!r) return json({ error: 'Not found.' }, 404);
  const kind = KINDS[r.kind];
  const b = await request.json().catch(() => ({}));
  const A = mediaActor(data.mc.user), meta = { section: kind?.section, itemType: r.kind, itemId: r.id, itemTitle: r.title, request };
  if (b.action === 'submit') {
    const content = JSON.parse(r.data_json || '{}');
    const problem = kind?.validate ? kind.validate(content, { user: data.mc.user }) : null;
    if (problem) return json({ error: problem }, 400);
    let scheduledAt = null;
    if (kind?.schedulable && b.scheduledAt) {
      const t = Date.parse(b.scheduledAt);
      if (!t || t < Date.now() + 5 * 60e3) return json({ error: 'Choose a publish time at least 5 minutes from now, or publish on approval.' }, 400);
      scheduledAt = new Date(t).toISOString();
    }
    const res = await submitItem(env.DB, data.mc.user, r, { scheduledAt });
    if (res.error) return json({ error: res.error }, 409);
    await mcLog(env.DB, A, 'submit', { ...meta, details: [r.correction || ['published', 'scheduled'].includes(r.status) ? 'Correction' : null, scheduledAt ? `Publish at ${scheduledAt}` : null].filter(Boolean).join('; ') || null });
    return json({ ok: true });
  }
  if (b.action === 'withdraw') {
    if (r.status === 'submitted') await env.DB.prepare(`UPDATE mc_items SET status = 'draft' WHERE id = ?`).bind(r.id).run();
    else if (r.correction === 'submitted') await env.DB.prepare(`UPDATE mc_items SET correction = 'draft' WHERE id = ?`).bind(r.id).run();
    else return json({ error: 'This is not waiting for approval.' }, 409);
    await mcLog(env.DB, A, 'withdraw', meta);
    return json({ ok: true });
  }
  if (b.action === 'delete_draft') {
    // Only drafts that were never published (published content is unpublished by a Super Admin, never deleted).
    if (!['draft', 'returned', 'rejected'].includes(r.status) || r.published_at) return json({ error: 'Only drafts that were never published can be deleted.' }, 409);
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM mc_items WHERE id = ?`).bind(r.id),
      env.DB.prepare(`DELETE FROM mc_revisions WHERE item_id = ?`).bind(r.id),
    ]);
    await mcLog(env.DB, A, 'delete_draft', meta);
    return json({ ok: true });
  }
  return json({ error: 'Unknown action.' }, 400);
}
