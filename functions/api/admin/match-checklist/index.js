import { guard, json, SUPER_ONLY, readOnlyRole } from '../../_lib/checklistApi.js';
import { syncChecklists, loadChecklist, logActivity, STATUS_LABEL, PHASE_LABEL } from '../../_lib/matchChecklist.js';
import { logAdminAction } from '../../_lib/adminSession.js';

// Match Checklist (Admin › Matchday › Match Checklist).
// GET                  -- the open checklists (next match first; tabs for back-to-back matches)
// GET ?id=<id>         -- one checklist (also closed ones, read-only)
// GET ?task=<id>       -- the checklist holding that task (for "Back to checklist")
// GET ?view=archive    -- closed checklists with their final progress
// POST { action: 'close', id, note }  -- Super Admins: close a checklist (moves it to the archive)
export async function onRequestGet({ request, env }) {
  const { admin, superAdmin, denied } = await guard(request, env);
  if (denied) return denied;
  const db = env.DB;
  const u = new URL(request.url);
  const me = { name: admin.name, isSuper: superAdmin, readOnly: readOnlyRole(admin) };
  try { await syncChecklists(env); } catch (err) { console.error('[checklist] sync', err); }

  if (u.searchParams.get('view') === 'archive') {
    const { results } = await db.prepare(`SELECT c.id, c.match_id, c.kickoff_at, c.closed_at, c.note, e.home_team, e.away_team, e.competition,
        (SELECT COUNT(*) FROM match_checklist_tasks t WHERE t.match_checklist_id = c.id) AS total,
        (SELECT COUNT(*) FROM match_checklist_tasks t WHERE t.match_checklist_id = c.id AND t.status IN ('done', 'not_applicable')) AS finished
      FROM match_checklists c LEFT JOIN events e ON e.id = c.match_id WHERE c.status = 'closed' ORDER BY c.kickoff_at DESC LIMIT 200`).all();
    return json({ me, archive: results.map(r => ({ id: r.id, headline: r.home_team ? `${r.home_team} vs ${r.away_team}` : '(match removed)', competition: r.competition || '', kickoff: r.kickoff_at, closedAt: r.closed_at, note: r.note, pct: r.total ? Math.round((r.finished / r.total) * 100) : 0, total: r.total, finished: r.finished })) });
  }

  let ids = [];
  const one = u.searchParams.get('id'), task = u.searchParams.get('task');
  if (/^\d+$/.test(one || '')) ids = [Number(one)];
  else if (/^\d+$/.test(task || '')) {
    const t = await db.prepare(`SELECT match_checklist_id FROM match_checklist_tasks WHERE id = ?`).bind(Number(task)).first();
    if (t) ids = [t.match_checklist_id];
  }
  const open = (await db.prepare(`SELECT id FROM match_checklists WHERE status IN ('active', 'awaiting_closeout') ORDER BY kickoff_at`).all()).results.map(r => r.id);
  if (!ids.length) ids = open;
  const checklists = [];
  for (const id of ids) { const c = await loadChecklist(db, id, Date.now(), { env }); if (c) checklists.push(c); }
  const staff = superAdmin ? (await db.prepare(`SELECT id, name FROM admin_users WHERE active = 1 AND role NOT IN ('gate_staff', 'kitchen_staff', 'kitchen') ORDER BY name`).all()).results : [];
  return json({ me, checklists, open, staff, labels: { status: STATUS_LABEL, phase: PHASE_LABEL } });
}

export async function onRequestPost({ request, env }) {
  const { admin, superAdmin, denied } = await guard(request, env, { write: true });
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  if (b.action !== 'close') return json({ error: 'Unknown action' }, 400);
  if (!superAdmin) return json({ error: SUPER_ONLY }, 403);
  const id = Number(b.id);
  const c = await env.DB.prepare(`SELECT id, status FROM match_checklists WHERE id = ?`).bind(id).first();
  if (!c) return json({ error: 'Checklist not found' }, 404);
  if (c.status === 'closed') return json({ ok: true, already: true });
  const note = String(b.note || '').trim().slice(0, 300) || `Closed by ${admin.name}`;
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE match_checklists SET status = 'closed', note = ?, closed_by = ?, closed_at = ?, updated_at = ? WHERE id = ?`).bind(note, admin.id, now, now, id).run();
  await logActivity(env.DB, { checklistId: id, admin, action: 'closed', newValue: note });
  await logAdminAction(env.DB, admin, 'checklist_closed', `Match checklist ${id}: ${note}`);
  return json({ ok: true });
}
