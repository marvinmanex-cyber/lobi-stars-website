import { guard, json, taskWithChecklist, checkUpload, safeFileName } from '../../../../_lib/checklistApi.js';
import { logActivity } from '../../../../_lib/matchChecklist.js';

// A task's attachment, kept PRIVATE in R2 (PROGRAMME_BUCKET, folder
// checklist-files/) under a random name; only signed-in staff can open it here.
// POST (multipart, field "file"): PDF, JPG, PNG, DOCX or XLSX, at most 10 MB; replaces the previous one.
// GET: downloads it.
const bucket = env => env.PROGRAMME_BUCKET || null;
const hex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');

export async function onRequestPost({ request, env, params }) {
  const { admin, denied } = await guard(request, env, { write: true });
  if (denied) return denied;
  if (!bucket(env)) return json({ error: 'File storage is not set up on this server.' }, 503);
  const t = await taskWithChecklist(env.DB, Number(params.id));
  if (!t) return json({ error: 'Task not found' }, 404);
  if (t.checklist_status === 'closed') return json({ error: 'This checklist is closed (archive): it can no longer be changed.' }, 409);
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > 10.5 * 1024 * 1024) return json({ error: 'The file is larger than 10 MB.' }, 413);
  let form;
  try { form = await request.formData(); } catch { return json({ error: 'Send the file as a form upload.' }, 400); }
  const file = form.get('file');
  if (!file || typeof file === 'string') return json({ error: 'No file was sent.' }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ok = checkUpload(file.name, bytes);
  if (ok.error) return json({ error: ok.error }, 400);
  const key = `checklist-files/${t.match_checklist_id}/${t.id}-${hex(16)}.${ok.ext}`;
  await bucket(env).put(key, bytes, { httpMetadata: { contentType: ok.type }, customMetadata: { name: safeFileName(file.name), by: admin.name } });
  if (t.attachment_path) { try { await bucket(env).delete(t.attachment_path); } catch {} }
  await env.DB.prepare(`UPDATE match_checklist_tasks SET attachment_path = ?, attachment_name = ?, updated_at = ? WHERE id = ?`).bind(key, safeFileName(file.name), new Date().toISOString(), t.id).run();
  await logActivity(env.DB, { taskId: t.id, checklistId: t.match_checklist_id, admin, action: 'file_uploaded', oldValue: t.attachment_name || '', newValue: safeFileName(file.name) });
  return json({ ok: true, name: safeFileName(file.name) });
}

export async function onRequestGet({ request, env, params }) {
  const { denied } = await guard(request, env);
  if (denied) return denied;
  const t = await taskWithChecklist(env.DB, Number(params.id));
  if (!t || !t.attachment_path || !bucket(env)) return json({ error: 'No file on this task.' }, 404);
  const obj = await bucket(env).get(t.attachment_path);
  if (!obj) return json({ error: 'The file could not be found.' }, 404);
  const name = t.attachment_name || 'attachment';
  return new Response(obj.body, { headers: {
    'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${name.replace(/"/g, '')}"`,
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
  } });
}
