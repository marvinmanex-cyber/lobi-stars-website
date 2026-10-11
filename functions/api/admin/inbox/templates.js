import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { randomId } from '../../_lib/crypto.js';
import { ensureInboxSchema, sanitizeHtml, htmlToText } from '../../_lib/inbox.js';

// GET  /api/admin/inbox/templates -- saved replies.
// POST /api/admin/inbox/templates
//   { action: 'save', id?, name, html }   add (no id) or change a template
//   { action: 'delete', id }
// Templates can use {first_name}, {staff_name} and {ref}.
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  await ensureInboxSchema(env.DB);
  const { results } = await env.DB.prepare(`SELECT id, name, body_html, updated_at, updated_by FROM inbox_templates ORDER BY name`).all();
  return Response.json({ templates: results }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureInboxSchema(db);
  const b = await request.json().catch(() => ({}));
  if (b.action === 'save') {
    const name = String(b.name || '').trim().slice(0, 80);
    const html = await sanitizeHtml(b.html);
    if (!name || !htmlToText(html)) return Response.json({ error: 'Please give the template a name and some text.' }, { status: 400 });
    const id = b.id ? String(b.id) : randomId('TPL', 8);
    await db.prepare(`INSERT INTO inbox_templates (id, name, body_html, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET name = excluded.name, body_html = excluded.body_html, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .bind(id, name, html, new Date().toISOString(), admin.name).run();
    await logAdminAction(db, admin, 'inbox_template_save', name);
    return Response.json({ ok: true, id });
  }
  if (b.action === 'delete') {
    const row = await db.prepare(`SELECT name FROM inbox_templates WHERE id = ?`).bind(String(b.id || '')).first();
    if (!row) return Response.json({ error: 'Template not found.' }, { status: 404 });
    await db.prepare(`DELETE FROM inbox_templates WHERE id = ?`).bind(String(b.id)).run();
    await logAdminAction(db, admin, 'inbox_template_delete', row.name);
    return Response.json({ ok: true });
  }
  return Response.json({ error: 'Unknown action' }, { status: 400 });
}
