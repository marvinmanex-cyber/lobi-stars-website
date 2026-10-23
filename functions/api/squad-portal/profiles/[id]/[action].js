import { requirePortal, portalJson, portalActor } from '../../../_lib/squadPortal.js';
import { submitProfile, savePhoto, deletePhoto, saveEvidence, deleteEvidence } from '../../../_lib/squadProfiles.js';

// POST   /api/squad-portal/profiles/:id/submit           -- for approval by a Super Admin (all required answers, photo, free shirt number)
// POST   /api/squad-portal/profiles/:id/photo  (form)    -- kind, w400, w1200, jpg, width, height, warnings
// POST   /api/squad-portal/profiles/:id/evidence (form) -- file: a photo or PDF backing the international career
// DELETE /api/squad-portal/profiles/:id/photo?kind=profile|action   or   /evidence
// (Name recordings were removed on 22 Oct 2026: /audio answers 410.)
export async function onRequestPost({ request, env, params, waitUntil }) {
  const { session, denied } = await requirePortal(request, env, { write: true });
  if (denied) return denied;
  const actor = portalActor(session);
  let r;
  if (params.action === 'submit') {
    r = await submitProfile(env, actor, params.id);
    if (r.ok) {
      // The Super Admins are told by the admin bell and the 30-minute digest (squadApprovals.js digestTick).
      delete r.profile;
    }
  } else if (params.action === 'photo') {
    const form = await request.formData().catch(() => null);
    if (!form) return portalJson({ error: 'The upload did not arrive. Please try again.' }, 400);
    r = await savePhoto(env, actor, params.id, form);
  } else if (params.action === 'evidence') {
    const form = await request.formData().catch(() => null);
    if (!form) return portalJson({ error: 'The upload did not arrive. Please try again.' }, 400);
    r = await saveEvidence(env, actor, params.id, form);
  } else if (params.action === 'audio') return portalJson({ error: 'Name recordings are no longer used.' }, 410);
  else return portalJson({ error: 'Not found' }, 404);
  return r.error ? portalJson(r, r.status || 400) : portalJson(r);
}
export async function onRequestDelete({ request, env, params }) {
  const { session, denied } = await requirePortal(request, env, { write: true });
  if (denied) return denied;
  if (params.action === 'evidence') { const r = await deleteEvidence(env, portalActor(session), params.id); return r.error ? portalJson(r, r.status || 400) : portalJson(r); }
  if (params.action !== 'photo') return portalJson({ error: 'Not found' }, 404);
  const r = await deletePhoto(env, portalActor(session), params.id, new URL(request.url).searchParams.get('kind'));
  return r.error ? portalJson(r, r.status || 400) : portalJson(r);
}
