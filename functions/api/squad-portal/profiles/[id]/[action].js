import { requirePortal, portalJson, portalActor } from '../../../_lib/squadPortal.js';
import { submitProfile, savePhoto, saveAudio, deletePhoto } from '../../../_lib/squadProfiles.js';
import { notifyReviewers } from '../../../_lib/squadNotify.js';

// POST   /api/squad-portal/profiles/:id/submit           -- for club review (all required answers, photo, free shirt number)
// POST   /api/squad-portal/profiles/:id/photo  (form)    -- kind, w400, w1200, jpg, width, height, warnings
// POST   /api/squad-portal/profiles/:id/audio  (form)    -- original, mp3, seconds
// DELETE /api/squad-portal/profiles/:id/photo?kind=profile|action   or   /audio
export async function onRequestPost({ request, env, params, waitUntil }) {
  const { session, denied } = await requirePortal(request, env, { write: true });
  if (denied) return denied;
  const actor = portalActor(session);
  let r;
  if (params.action === 'submit') {
    r = await submitProfile(env, actor, params.id);
    if (r.ok) {
      const job = notifyReviewers(env, r.profile, session.name).catch(err => console.error('[squad] notify', err));
      if (waitUntil) waitUntil(job); else await job;
      delete r.profile;
    }
  } else if (params.action === 'photo' || params.action === 'audio') {
    const form = await request.formData().catch(() => null);
    if (!form) return portalJson({ error: 'The upload did not arrive. Please try again.' }, 400);
    r = params.action === 'photo' ? await savePhoto(env, actor, params.id, form) : await saveAudio(env, actor, params.id, form);
  } else return portalJson({ error: 'Not found' }, 404);
  return r.error ? portalJson(r, r.status || 400) : portalJson(r);
}
export async function onRequestDelete({ request, env, params }) {
  const { session, denied } = await requirePortal(request, env, { write: true });
  if (denied) return denied;
  if (!['photo', 'audio'].includes(params.action)) return portalJson({ error: 'Not found' }, 404);
  const kind = params.action === 'audio' ? 'audio' : new URL(request.url).searchParams.get('kind');
  const r = await deletePhoto(env, portalActor(session), params.id, kind);
  return r.error ? portalJson(r, r.status || 400) : portalJson(r);
}
