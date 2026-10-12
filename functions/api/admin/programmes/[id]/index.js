import { requireAdminUser } from '../../../_lib/adminEvents.js';
import { logAdminAction } from '../../../_lib/adminSession.js';
import { ensureProgrammeSchema, programmeStats, STATUSES, isLive, bucket, r2Keys, cleanDetails } from '../../../_lib/programme.js';
import { ensureFanSchema } from '../../../_lib/fans.js';

// GET    /api/admin/programmes/:id  -- details, quick links and stats
// PATCH  /api/admin/programmes/:id  -- edit details and/or { status, publishAt }
//   scheduled: needs uploaded files and a future publishAt; published: needs files;
//   draft / hidden: always allowed
// DELETE /api/admin/programmes/:id  -- only if it was never published (removes files too)
async function load(db, id) {
  await ensureProgrammeSchema(db);
  return db.prepare(`SELECT * FROM programmes WHERE id = ?`).bind(Number(id) || 0).first();
}

export async function onRequestGet({ request, env, params }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const p = await load(env.DB, params.id);
    if (!p) return Response.json({ error: 'Programme not found' }, { status: 404 });
    await ensureFanSchema(env.DB);
    const [links, pages] = await env.DB.batch([
      env.DB.prepare(`SELECT id, label, url, sort_order FROM programme_links WHERE programme_id = ? ORDER BY sort_order, id`).bind(p.id),
      env.DB.prepare(`SELECT page_number, width, height FROM programme_pages WHERE programme_id = ? ORDER BY page_number`).bind(p.id),
    ]);
    return Response.json({ programme: { ...p, live: isLive(p) }, links: links.results, pages: pages.results, stats: await programmeStats(env.DB, p.id) });
  } catch (err) {
    console.error('[admin programmes] get', err);
    return Response.json({ error: 'Could not load the programme.' }, { status: 500 });
  }
}

export async function onRequestPatch({ request, env, params }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    const p = await load(db, params.id);
    if (!p) return Response.json({ error: 'Programme not found' }, { status: 404 });
    const b = await request.json().catch(() => ({}));
    const now = new Date();
    const sets = [], binds = [], changes = [];

    if (b.title !== undefined) {
      const { value: v, error } = cleanDetails({ ...p, kickoffAt: p.kickoff_at, ...b });
      if (error) return Response.json({ error }, { status: 400 });
      for (const [col, key] of [['title', 'title'], ['opponent', 'opponent'], ['competition', 'competition'], ['venue', 'venue'], ['kickoff_at', 'kickoffAt'], ['notes', 'notes']]) {
        const val = v[key] || null;
        if (val !== (p[col] || null)) { sets.push(`${col} = ?`); binds.push(val); changes.push(`${col}: ${p[col] || '–'} → ${val || '–'}`); }
      }
    }

    if (b.status !== undefined) {
      const status = String(b.status);
      if (!STATUSES.includes(status)) return Response.json({ error: 'Unknown status.' }, { status: 400 });
      if ((status === 'scheduled' || status === 'published') && !p.pdf_key) {
        return Response.json({ error: 'Upload the programme PDF first.' }, { status: 409 });
      }
      if (status === 'scheduled') {
        const at = Date.parse(String(b.publishAt || ''));
        if (Number.isNaN(at) || at <= now.getTime()) return Response.json({ error: 'Choose a publish time in the future.' }, { status: 400 });
        sets.push(`publish_at = ?`); binds.push(new Date(at).toISOString());
      }
      if (status === 'published') { sets.push(`published_at = COALESCE(published_at, ?)`, `publish_at = NULL`); binds.push(now.toISOString()); }
      sets.push(`status = ?`); binds.push(status);
      changes.push(`status: ${p.status} → ${status}${status === 'scheduled' ? ` (${new Date(Date.parse(b.publishAt)).toISOString()})` : ''}`);
    }
    if (!sets.length) return Response.json({ ok: true, unchanged: true });
    sets.push(`updated_at = datetime('now')`);
    await db.prepare(`UPDATE programmes SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, p.id).run();
    // A scheduled programme counts as published once its time comes.
    await logAdminAction(db, admin, 'programme_update', `${p.title}: ${changes.join('; ')}`);
    const fresh = await load(db, p.id);
    return Response.json({ ok: true, programme: { ...fresh, live: isLive(fresh) } });
  } catch (err) {
    console.error('[admin programmes] patch', err);
    return Response.json({ error: 'Could not save the programme.' }, { status: 500 });
  }
}

export async function onRequestDelete({ request, env, params, waitUntil }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    const p = await load(db, params.id);
    if (!p) return Response.json({ error: 'Programme not found' }, { status: 404 });
    if (p.published_at || isLive(p)) return Response.json({ error: 'This programme has been published, so it can only be hidden, not deleted.' }, { status: 409 });
    await db.batch([
      db.prepare(`DELETE FROM programme_pages WHERE programme_id = ?`).bind(p.id),
      db.prepare(`DELETE FROM programme_links WHERE programme_id = ?`).bind(p.id),
      db.prepare(`DELETE FROM programme_events WHERE programme_id = ?`).bind(p.id),
      db.prepare(`DELETE FROM programmes WHERE id = ?`).bind(p.id),
    ]);
    const b = bucket(env);
    if (b && p.version > 0) {
      const k = r2Keys(p.slug, p.version);
      waitUntil(b.delete([k.pdf, k.cover, ...k.pages]).catch(err => console.error('[admin programmes] delete files', err)));
    }
    await logAdminAction(db, admin, 'programme_delete', `${p.title} (${p.slug})`);
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[admin programmes] delete', err);
    return Response.json({ error: 'Could not delete the programme.' }, { status: 500 });
  }
}
