import { requireAdminUser } from '../../../_lib/adminEvents.js';
import { logAdminAction } from '../../../_lib/adminSession.js';
import { ensureProgrammeSchema, cleanLinkUrl, stripTags } from '../../../_lib/programme.js';

// PUT /api/admin/programmes/:id/links { links: [{ label, url }] } -- replaces all
// quick links (max 8; https or a page on this site; label 1-40 characters).
export async function onRequestPut({ request, env, params }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    await ensureProgrammeSchema(db);
    const p = await db.prepare(`SELECT id, title FROM programmes WHERE id = ?`).bind(Number(params.id) || 0).first();
    if (!p) return Response.json({ error: 'Programme not found' }, { status: 404 });
    const b = await request.json().catch(() => ({}));
    const rows = Array.isArray(b.links) ? b.links : [];
    if (rows.length > 8) return Response.json({ error: 'Up to 8 quick links.' }, { status: 400 });
    const clean = [];
    for (const [i, l] of rows.entries()) {
      const label = stripTags(l?.label).slice(0, 41);
      const url = cleanLinkUrl(l?.url);
      if (!label || label.length > 40) return Response.json({ error: `Link ${i + 1}: the label must be 1 to 40 characters.` }, { status: 400 });
      if (!url) return Response.json({ error: `Link ${i + 1}: the address must start with https:// (or be a page on this site, e.g. /food).` }, { status: 400 });
      clean.push({ label, url });
    }
    await db.batch([
      db.prepare(`DELETE FROM programme_links WHERE programme_id = ?`).bind(p.id),
      ...clean.map((l, i) => db.prepare(`INSERT INTO programme_links (programme_id, label, url, sort_order) VALUES (?, ?, ?, ?)`).bind(p.id, l.label, l.url, i)),
    ]);
    await logAdminAction(db, admin, 'programme_links', `${p.title}: ${clean.map(l => l.label).join(', ') || 'none'}`);
    const { results } = await db.prepare(`SELECT id, label, url, sort_order FROM programme_links WHERE programme_id = ? ORDER BY sort_order`).bind(p.id).all();
    return Response.json({ ok: true, links: results });
  } catch (err) {
    console.error('[admin programmes] links', err);
    return Response.json({ error: 'Could not save the links.' }, { status: 500 });
  }
}
