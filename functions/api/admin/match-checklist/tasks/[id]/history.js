import { guard, json } from '../../../../_lib/checklistApi.js';

// GET /api/admin/match-checklist/tasks/<id>/history -- every change to the task, newest first.
export async function onRequestGet({ request, env, params }) {
  const { denied } = await guard(request, env);
  if (denied) return denied;
  const { results } = await env.DB.prepare(`SELECT action, admin_name, old_value, new_value, reason, created_at FROM checklist_activity_log
    WHERE match_checklist_task_id = ? ORDER BY id DESC LIMIT 100`).bind(Number(params.id)).all();
  return json({ history: results });
}
