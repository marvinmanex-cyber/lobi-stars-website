import { guard, json, SUPER_ONLY, taskWithChecklist, changeStatus, readOnlyRole } from '../../../_lib/checklistApi.js';
import { logActivity, linkContext, buildTaskLink, STATUS_LABEL } from '../../../_lib/matchChecklist.js';

// One Match Checklist task.
// GET   -- what the "Checklist task" banner and the "Go to task" page need: the
//          task, its match, its link (built now) and what this person may do.
// PATCH { status, reason } | { notes } | { owner_admin_id, owner_unit }
//   status: everyone (in progress / submitted for review); Super Admins: done,
//   not applicable, untick (with a reason). Owners: Super Admins only.
export async function onRequestGet({ request, env, params }) {
  const { admin, superAdmin, denied } = await guard(request, env);
  if (denied) return denied;
  const t = await taskWithChecklist(env.DB, Number(params.id));
  if (!t) return json({ error: 'Task not found' }, 404);
  const e = await env.DB.prepare(`SELECT id, home_team, away_team, competition, venue, event_date FROM events WHERE id = ?`).bind(t.match_id).first();
  const match = e ? { id: e.id, home: e.home_team, away: e.away_team, kickoff: e.event_date, slug: '' } : { id: t.match_id, home: '(match removed)', away: '', kickoff: null };
  if (e) { const { matchSlug } = await import('../../../_lib/matchSlug.js'); match.slug = matchSlug(e); }
  const link = buildTaskLink(t, await linkContext(env, env.DB, match));
  return json({
    task: { id: t.id, title: t.title, status: t.status, statusLabel: STATUS_LABEL[t.status], phase: t.phase, due_at: t.due_at },
    checklist: { id: t.checklist_id, status: t.checklist_status },
    headline: match.away ? `${match.home} vs ${match.away}` : match.home,
    link,
    me: { isSuper: superAdmin, readOnly: readOnlyRole(admin), name: admin.name },
  });
}

export async function onRequestPatch({ request, env, params }) {
  const { admin, superAdmin, denied } = await guard(request, env, { write: true });
  if (denied) return denied;
  const db = env.DB;
  const t = await taskWithChecklist(db, Number(params.id));
  if (!t) return json({ error: 'Task not found' }, 404);
  if (t.checklist_status === 'closed') return json({ error: 'This checklist is closed (archive): it can no longer be changed.' }, 409);
  const b = await request.json().catch(() => ({}));
  const now = new Date().toISOString();

  if (b.owner_admin_id !== undefined || b.owner_unit !== undefined) {
    if (!superAdmin) return json({ error: SUPER_ONLY }, 403);
    let ownerId = b.owner_admin_id === undefined ? t.owner_admin_id : (b.owner_admin_id || null);
    if (ownerId) {
      const ok = await db.prepare(`SELECT id, name FROM admin_users WHERE id = ? AND active = 1`).bind(String(ownerId)).first();
      if (!ok) return json({ error: 'That staff member was not found.' }, 400);
      ownerId = ok.id;
    }
    const unit = b.owner_unit === undefined ? t.owner_unit : (String(b.owner_unit || '').trim().slice(0, 60) || null);
    await db.prepare(`UPDATE match_checklist_tasks SET owner_admin_id = ?, owner_unit = ?, updated_at = ? WHERE id = ?`).bind(ownerId, unit, now, t.id).run();
    await logActivity(db, { taskId: t.id, checklistId: t.match_checklist_id, admin, action: 'owner_changed', oldValue: `${t.owner_admin_id || '-'} / ${t.owner_unit || '-'}`, newValue: `${ownerId || '-'} / ${unit || '-'}` });
  }
  if (b.notes !== undefined) {
    const notes = String(b.notes || '').slice(0, 2000);
    if (notes !== (t.notes || '')) {
      await db.prepare(`UPDATE match_checklist_tasks SET notes = ?, updated_at = ? WHERE id = ?`).bind(notes || null, now, t.id).run();
      await logActivity(db, { taskId: t.id, checklistId: t.match_checklist_id, admin, action: 'note_added', oldValue: t.notes || '', newValue: notes });
    }
  }
  if (b.status !== undefined) {
    const r = await changeStatus(db, admin, t, String(b.status), b.reason);
    if (r.error) return json({ error: r.error }, r.status);
  }
  const after = await db.prepare(`SELECT id, status, notes, owner_admin_id, owner_unit, completed_by_name, completed_at FROM match_checklist_tasks WHERE id = ?`).bind(t.id).first();
  const list = await db.prepare(`SELECT status FROM match_checklists WHERE id = ?`).bind(t.match_checklist_id).first();
  return json({ ok: true, task: after, checklistStatus: list?.status });
}
