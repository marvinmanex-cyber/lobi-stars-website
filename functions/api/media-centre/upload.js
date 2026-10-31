import { storeFile } from '../_lib/mediaFiles.js';
import { mcLog, mediaActor, json } from '../_lib/mediaCentre.js';
import { rateLimit } from '../_lib/fans.js';

// POST /api/media-centre/upload (multipart: file, kind = image | document, width, height, section)
// Pictures arrive already resized by the page; the server checks type and size (5 MB).
export async function onRequestPost({ request, env, data }) {
  const user = data.mc.user;
  if (!(await rateLimit(env.DB, `mcupload:${user.id}`, 120, 3600))) return json({ error: 'Too many uploads in the last hour. Please wait a little.' }, 429);
  let form;
  try { form = await request.formData(); } catch { return json({ error: 'No file was received.' }, 400); }
  const kind = form.get('kind') === 'document' ? 'document' : 'image';
  const blob = form.get('file');
  const r = await storeFile(env, { blob, kind, name: blob?.name || '', width: form.get('width'), height: form.get('height'), by: user.id, byName: user.fullName });
  if (r.error) return json({ error: r.error }, 400);
  const section = String(form.get('section') || '').replace(/[^a-z]/g, '').slice(0, 20) || null;
  await mcLog(env.DB, mediaActor(user), 'upload', { section, itemType: 'file', itemId: r.file.id, itemTitle: blob?.name || r.file.id, details: `${r.file.mime}, ${Math.round(r.file.bytes / 1024)} KB`, request });
  return json({ ok: true, file: r.file });
}
