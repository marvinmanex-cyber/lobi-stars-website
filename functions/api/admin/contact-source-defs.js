import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { can } from '../_lib/adminRoles.js';
import { ensureContactsSchema, getSources, SOURCES } from '../_lib/contacts.js';

const COLOR = /^#[0-9A-Fa-f]{6}$/;

// GET  /api/admin/contact-source-defs -- every contact source (label, colour, order).
// POST /api/admin/contact-source-defs (Settings access)
//   { action: 'save', key, label, color }   rename / recolour a source
//   { action: 'add', label, color }         a new source for a future form (returns its key)
//   { action: 'order', keys: [...] }        the order in charts and lists
//   { action: 'delete', key }               remove an added source nobody has used yet
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  return Response.json({ sources: await getSources(env.DB) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  if (!can(admin, 'settings.site')) return Response.json({ error: 'Only staff with Settings access can change sources.' }, { status: 403 });
  const db = env.DB;
  await ensureContactsSchema(db);
  const b = await request.json().catch(() => ({}));
  const now = new Date().toISOString();
  const current = await getSources(db);
  const upsert = (key, label, color, sort) => db.prepare(`INSERT INTO contact_source_defs (key, label, color, sort, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET label = excluded.label, color = excluded.color, sort = excluded.sort, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .bind(key, label, color, sort, now, admin.name);

  if (b.action === 'save' || b.action === 'add') {
    const label = String(b.label || '').trim().slice(0, 40);
    if (!label) return Response.json({ error: 'Please type a name.' }, { status: 400 });
    const color = COLOR.test(b.color || '') ? b.color : '#64748B';
    if (b.action === 'save') {
      const s = current.find(x => x.key === b.key);
      if (!s) return Response.json({ error: 'Source not found.' }, { status: 404 });
      await upsert(s.key, label, color, s.sort).run();
      await logAdminAction(db, admin, 'contact_source_edit', `${s.key}: ${label}`);
    } else {
      let key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'source';
      while (SOURCES[key] || current.some(x => x.key === key)) key += '_2';
      await upsert(key, label, color, Math.max(0, ...current.map(x => x.sort)) + 1).run();
      await logAdminAction(db, admin, 'contact_source_add', `${key}: ${label}`);
      return Response.json({ ok: true, key, sources: await getSources(db) });
    }
  } else if (b.action === 'delete') {
    // Only sources added in Settings, and only while no contact uses them.
    const s = current.find(x => x.key === b.key);
    if (!s || s.builtin) return Response.json({ error: 'Built-in sources can be renamed but not deleted.' }, { status: 400 });
    const used = await db.prepare(`SELECT 1 FROM contact_sources WHERE source = ? LIMIT 1`).bind(s.key).first();
    if (used) return Response.json({ error: 'Contacts already came from this source, so it is kept.' }, { status: 409 });
    await db.prepare(`DELETE FROM contact_source_defs WHERE key = ?`).bind(s.key).run();
    await logAdminAction(db, admin, 'contact_source_delete', s.key);
  } else if (b.action === 'order') {
    const keys = Array.isArray(b.keys) ? b.keys.map(String) : [];
    const stmts = keys.map((k, i) => { const s = current.find(x => x.key === k); return s ? upsert(s.key, s.label, s.color, i) : null; }).filter(Boolean);
    if (stmts.length) await db.batch(stmts);
  } else return Response.json({ error: 'Unknown action' }, { status: 400 });
  return Response.json({ ok: true, sources: await getSources(db) });
}
