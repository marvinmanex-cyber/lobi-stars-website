import { ensureMediaSchema, createItem, itemView, mcLog, mediaActor, json, oneLine } from '../../_lib/mediaCentre.js';
import { KINDS } from '../../_lib/mediaKinds.js';

// GET  /api/media-centre/items?kind=news[&status=draft] -- the team's items of one kind (newest first).
// POST /api/media-centre/items { kind, title, data, ref } -- a new draft.
export async function onRequestGet({ request, env }) {
  await ensureMediaSchema(env.DB);
  const u = new URL(request.url);
  const kind = u.searchParams.get('kind') || '';
  if (!KINDS[kind]) return json({ error: 'Unknown kind.' }, 400);
  const status = u.searchParams.get('status') || '';
  const rows = (await env.DB.prepare(`SELECT * FROM mc_items WHERE kind = ? ${status ? 'AND status = ?' : ''} ORDER BY updated_at DESC LIMIT 200`)
    .bind(...[kind, status].filter(Boolean)).all()).results;
  return json({ items: rows.map(r => itemView(r, { full: false })) });
}

export async function onRequestPost({ request, env, data }) {
  const b = await request.json().catch(() => ({}));
  const kind = KINDS[b.kind];
  if (!kind || kind.mediaCreate === false) return json({ error: 'Unknown kind.' }, 400);
  const checked = kind.normalise ? kind.normalise(b.data || {}, { user: data.mc.user }) : { value: b.data || {} };
  if (checked.error) return json({ error: checked.error }, 400);
  const title = kind.titleOf ? kind.titleOf(checked.value) : oneLine(b.title, 200);
  const id = await createItem(env.DB, data.mc.user, b.kind, { title, data: checked.value, ref: b.ref ? oneLine(b.ref, 80) : null });
  await mcLog(env.DB, mediaActor(data.mc.user), 'create', { section: kind.section, itemType: b.kind, itemId: id, itemTitle: title, request });
  return json({ ok: true, id });
}
