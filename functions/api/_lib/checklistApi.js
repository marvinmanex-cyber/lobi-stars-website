// Shared by the Match Checklist admin API (functions/api/admin/match-checklist/).
// Viewing needs matchday.checklist.view (every staff role except the gate and
// kitchen helpers, see adminRoles.js). Ticking done, "not applicable",
// unticking, owners, closing, templates and settings: Super Admins only,
// checked here on the server (403 otherwise).
import { requireAdminUser } from './adminEvents.js';
import { can, roleOf, ROLE_DEFAULTS } from './adminRoles.js';
import { ensureChecklistSchema, logActivity, closeIfComplete, CLOSED_TASK, STATUSES } from './matchChecklist.js';

export const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });
export const SUPER_ONLY = 'Only Super Admins can do this.';
export const isSuper = admin => roleOf(admin) === 'super_admin';
export const readOnlyRole = admin => !!ROLE_DEFAULTS[roleOf(admin)]?.readOnly;

/**
 * Signed in, may view the checklist, and (for changes) the request comes from
 * this website: an Origin header from anywhere else is refused (CSRF), on top
 * of the admin cookie being SameSite=Strict.
 */
export async function guard(request, env, { write = false } = {}) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return { denied };
  if (!can(admin, 'matchday.checklist.view')) return { denied: json({ error: 'Your role does not include the Match Checklist.' }, 403) };
  if (write) {
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) return { denied: json({ error: 'This request must come from the Lobi Stars admin.' }, 403) };
    if (readOnlyRole(admin)) return { denied: json({ error: 'Your role can only view the checklist.' }, 403) };
  }
  await ensureChecklistSchema(env.DB);
  return { admin, superAdmin: isSuper(admin) };
}

/** The task with its checklist's status (null if not found). */
export const taskWithChecklist = (db, id) => db.prepare(`SELECT t.*, c.status AS checklist_status, c.id AS checklist_id, c.match_id FROM match_checklist_tasks t
  JOIN match_checklists c ON c.id = t.match_checklist_id WHERE t.id = ?`).bind(id).first();

const ADMIN_STATUSES = ['not_started', 'in_progress', 'submitted_for_review'];

/**
 * Changes a task's status with the permission rules:
 * - everyone (not read-only): not started / in progress / submitted for review, while the task isn't finished;
 * - Super Admins: done and not applicable, and unticking a finished task (a reason is required).
 * Returns { ok } or { error, status }.
 */
export async function changeStatus(db, admin, task, next, reason = '') {
  if (!STATUSES.includes(next)) return { error: 'Unknown status.', status: 400 };
  if (task.checklist_status === 'closed') return { error: 'This checklist is closed (archive): it can no longer be changed.', status: 409 };
  if (next === task.status) return { ok: true, unchanged: true };
  const sup = isSuper(admin);
  const finishing = CLOSED_TASK.has(next), unticking = CLOSED_TASK.has(task.status);
  if ((finishing || unticking) && !sup) return { error: finishing ? 'Only Super Admins can mark tasks as done or not applicable.' : 'Only Super Admins can untick a finished task.', status: 403 };
  if (!finishing && !unticking && !ADMIN_STATUSES.includes(next)) return { error: 'Unknown status.', status: 400 };
  const why = String(reason || '').trim();
  if (unticking && !why) return { error: 'Please give a reason for unticking this task.', status: 400 };
  const now = new Date().toISOString();
  if (next === 'done') {
    await db.prepare(`UPDATE match_checklist_tasks SET status = 'done', completed_by = ?, completed_by_name = ?, completed_at = ?, updated_at = ? WHERE id = ?`).bind(admin.id, admin.name, now, now, task.id).run();
  } else if (next === 'not_applicable') {
    await db.prepare(`UPDATE match_checklist_tasks SET status = 'not_applicable', completed_by = ?, completed_by_name = ?, completed_at = ?, updated_at = ? WHERE id = ?`).bind(admin.id, admin.name, now, now, task.id).run();
  } else {
    await db.prepare(`UPDATE match_checklist_tasks SET status = ?, completed_by = NULL, completed_by_name = NULL, completed_at = NULL, updated_at = ? WHERE id = ?`).bind(next, now, task.id).run();
  }
  await logActivity(db, { taskId: task.id, checklistId: task.match_checklist_id, admin, action: unticking ? 'unticked' : 'status_changed', oldValue: task.status, newValue: next, reason: why || null });
  if (finishing) await closeIfComplete(db, task.match_checklist_id, admin);
  return { ok: true };
}

// ── Uploads (private R2, random names) ──
export const MAX_UPLOAD = 10 * 1024 * 1024;
export const UPLOAD_TYPES = {
  pdf: { type: 'application/pdf', magic: b => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  jpg: { type: 'image/jpeg', magic: b => b[0] === 0xff && b[1] === 0xd8 },
  jpeg: { type: 'image/jpeg', magic: b => b[0] === 0xff && b[1] === 0xd8 },
  png: { type: 'image/png', magic: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  docx: { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: b => b[0] === 0x50 && b[1] === 0x4b },
  xlsx: { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: b => b[0] === 0x50 && b[1] === 0x4b },
};
/** { ext, type } if the file is allowed (extension AND content checked), else { error }. */
export function checkUpload(name, bytes) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  const t = UPLOAD_TYPES[ext];
  if (!t) return { error: 'Allowed files: PDF, JPG, PNG, Word (.docx) and Excel (.xlsx).' };
  if (bytes.length > MAX_UPLOAD) return { error: 'The file is larger than 10 MB.' };
  if (!bytes.length || !t.magic(bytes)) return { error: 'The file does not look like a real .' + ext + ' file.' };
  return { ext: ext === 'jpeg' ? 'jpg' : ext, type: t.type };
}
export const safeFileName = n => String(n || 'file').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100) || 'file';
