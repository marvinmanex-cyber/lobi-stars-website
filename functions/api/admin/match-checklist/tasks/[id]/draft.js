import { guard, json, taskWithChecklist, changeStatus } from '../../../../_lib/checklistApi.js';
import { logActivity } from '../../../../_lib/matchChecklist.js';
import { can } from '../../../../_lib/adminRoles.js';
import { draftInfo, prepareDraft, saveDraft } from '../../../../_lib/checklistDraft.js';

// "Draft with Claude" on a writing task of the Match Checklist.
// GET                                      -- available?, the match facts filled in, the last draft
// POST { action: 'prepare', facts, note } -- Claude writes the draft (or asks what is missing)
// POST { action: 'save', proposal }       -- save it (news: DRAFT in News; posts: used); the task
//                                            moves to "submitted for review"
// Drafting needs ai.draft (content editors, report roles and Super Admins).
export async function onRequestGet({ request, env, params }) {
  const { admin, denied } = await guard(request, env);
  if (denied) return denied;
  const t = await taskWithChecklist(env.DB, Number(params.id));
  if (!t) return json({ error: 'Task not found' }, 404);
  const info = await draftInfo(env, t, t.match_id);
  return json({ ...info, canDraft: can(admin, 'ai.draft') && t.checklist_status !== 'closed' });
}

export async function onRequestPost({ request, env, params }) {
  const { admin, denied } = await guard(request, env, { write: true });
  if (denied) return denied;
  if (!can(admin, 'ai.draft')) return json({ error: 'Drafting with Claude is not part of your role.' }, 403);
  const t = await taskWithChecklist(env.DB, Number(params.id));
  if (!t) return json({ error: 'Task not found' }, 404);
  if (t.checklist_status === 'closed') return json({ error: 'This checklist is closed (archive): it can no longer be changed.' }, 409);
  const b = await request.json().catch(() => ({}));
  try {
    if (b.action === 'prepare') {
      const r = await prepareDraft(env, admin, t, t.match_id, { staffFacts: b.facts, note: b.note });
      return r.error ? json(r, 400) : json(r);
    }
    if (b.action === 'save') {
      const r = await saveDraft(env, admin, t, t.match_id, b.proposal || {});
      if (r.error) return json(r, 400);
      // The draft is ready for a Super Admin to check: the task moves to "submitted for review".
      if (['not_started', 'in_progress'].includes(t.status)) await changeStatus(env.DB, admin, t, 'submitted_for_review');
      await logActivity(env.DB, { taskId: t.id, checklistId: t.match_checklist_id, admin, action: 'note_added', newValue: `Draft with Claude saved: ${r.saved.path || r.saved.note}` });
      return json(r);
    }
  } catch (err) {
    console.error('[checklist draft]', err);
    return json({ error: 'Something went wrong; nothing was saved.' }, 500);
  }
  return json({ error: 'Unknown action' }, 400);
}
