import { requirePortal, portalJson, portalActor } from '../../../_lib/squadPortal.js';
import { submitProfile, savePhoto, deletePhoto } from '../../../_lib/squadProfiles.js';
import { notifyReviewers } from '../../../_lib/squadNotify.js';

// POST   /api/squad-portal/profiles/:id/submit           -- for club review (all required answers, photo, free shirt number)
// POST   /api/squad-portal/profiles/:id/photo  (form)    -- kind, w400, w1200, jpg, width, height, warnings
// DELETE /api/squad-portal/profiles/:id/photo?kind=profile|action
// (Name recordings were removed on 22 Oct 2026: /audio answers 410.)
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
  } else if (params.action === 'photo') {
    const form = await request.formData().catch(() => null);
    if (!form) return portalJson({ error: 'The upload did not arrive. Please try again.' }, 400);
    r = await savePhoto(env, actor, params.id, form);
  } else if (params.action === 'audio') return portalJson({ error: 'Name recordings are no longer used.' }, 410);
  else return portalJson({ error: 'Not found' }, 404);
  return r.error ? portalJson(r, r.status || 400) : portalJson(r);
}
export async function onRequestDelete({ request, env, params }) {
  const { session, denied } = await requirePortal(request, env, { write: true });
  if (denied) return denied;
  if (params.action !== 'photo') return portalJson({ error: 'Not found' }, 404);
  const r = await deletePhoto(env, portalActor(session), params.id, new URL(request.url).searchParams.get('kind'));
  return r.error ? portalJson(r, r.status || 400) : portalJson(r);
}
