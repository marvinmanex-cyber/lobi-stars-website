import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { activityList, listUsers, LOG_SECTIONS, mcLog, adminActor, json } from '../../_lib/mediaCentre.js';

// GET /api/admin/media-centre/activity?user=&from=YYYY-MM-DD&to=&section=&action=&before=<id>[&format=csv]
// The Media Centre activity log (read-only: it can never be changed or deleted).
export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const u = new URL(request.url), q = k => (u.searchParams.get(k) || '').trim();
  const filters = { user: q('user'), from: /^\d{4}-\d{2}-\d{2}$/.test(q('from')) ? q('from') : '', to: /^\d{4}-\d{2}-\d{2}$/.test(q('to')) ? q('to') : '', section: q('section'), action: q('action') };
  if (q('format') === 'csv') {
    const rows = await activityList(env.DB, { ...filters, limit: 5000 });
    const cell = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s; };
    const head = ['Time (UTC)', 'Who', 'Kind', 'Action', 'Section', 'Item type', 'Item id', 'Item', 'Details', 'IP', 'Device'];
    const body = rows.map(r => [r.at, r.actor_name, r.actor_kind, r.action, r.section, r.item_type, r.item_id, r.item_title, r.details, r.ip, r.user_agent].map(cell).join(','));
    await mcLog(env.DB, adminActor(admin), 'export_log', { section: 'settings', details: `CSV, ${rows.length} rows`, request });
    await logAdminAction(env.DB, admin, 'export_media_activity_csv', `Media Centre activity log CSV (${rows.length} rows)`);
    return new Response(`﻿${[head.join(','), ...body].join('\r\n')}`, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="media-centre-activity-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' } });
  }
  const rows = await activityList(env.DB, { ...filters, limit: 200, before: q('before') || null });
  const actions = (await env.DB.prepare(`SELECT DISTINCT action FROM mc_activity ORDER BY action`).all()).results.map(r => r.action);
  return json({ rows, users: await listUsers(env.DB), sections: LOG_SECTIONS, actions });
}
