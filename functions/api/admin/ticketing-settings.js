import { getAdmin, logAdminAction } from '../_lib/adminSession.js';
import { roleOf } from '../_lib/adminRoles.js';
import { ensureEngineSchema, ticketingStatus, processorName, legacyImportConfirmed, setSetting, SETTING_PROCESSOR, SETTING_IMPORT_CONFIRMED } from '../_lib/ticketing/engineStore.js';

// /api/admin/ticketing-settings -- Super Admins (club executives) only, checked here AND by the
// admin middleware (this path is not given to any other role).
// GET  -> { mode, blockers, legalProcessorName, legacyImportConfirmed, alerts24h }
// POST { legalProcessorName?, legacyImportConfirmed? }
// No credentials, secrets or callback contents are ever returned.
const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });
async function superOnly(request, env) {
  const admin = await getAdmin(request, env);
  return admin && roleOf(admin) === 'super_admin' ? admin : null;
}

export async function onRequestGet({ request, env }) {
  const admin = await superOnly(request, env);
  if (!admin) return json({ error: 'Super Admins only.' }, 403);
  const db = env.DB;
  await ensureEngineSchema(db);
  const s = await ticketingStatus(env);
  const since = new Date(Date.now() - 86400e3).toISOString();
  const { results } = await db.prepare(`SELECT kind, COUNT(*) AS n FROM ticketing_log WHERE level = 'error' AND at >= ? GROUP BY kind`).bind(since).all();
  return json({ requested: s.requested, mode: s.active, blockers: s.blockers, legalProcessorName: (await processorName(db)) || '', legacyImportConfirmed: await legacyImportConfirmed(db), alerts24h: results });
}

export async function onRequestPost({ request, env }) {
  const admin = await superOnly(request, env);
  if (!admin) return json({ error: 'Super Admins only.' }, 403);
  const db = env.DB;
  await ensureEngineSchema(db);
  const b = await request.json().catch(() => ({}));
  const by = admin.name || admin.email || 'Super Admin';
  if (b.legalProcessorName !== undefined) {
    const name = String(b.legalProcessorName || '').replace(/[<>\u0000-\u001F]/g, '').trim().slice(0, 120);
    if (name && name.length < 3) return json({ error: 'Enter the company\'s full legal name, as registered.' }, 400);
    await setSetting(db, SETTING_PROCESSOR, name, by);
    await logAdminAction(db, admin, 'ticketing_processor', name ? `Payment processor legal name set to "${name}"` : 'Payment processor legal name cleared').catch(() => {});
  }
  if (b.legacyImportConfirmed !== undefined) {
    await setSetting(db, SETTING_IMPORT_CONFIRMED, b.legacyImportConfirmed ? '1' : '0', by);
    await logAdminAction(db, admin, 'ticketing_import', b.legacyImportConfirmed ? 'Old tickets confirmed as imported into the ticket system' : 'Old tickets: import not confirmed (checked locally)').catch(() => {});
  }
  return onRequestGet({ request, env });
}
