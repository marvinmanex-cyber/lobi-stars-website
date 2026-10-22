import { requirePortal, portalJson, portalActor } from '../../_lib/squadPortal.js';
import { getProfile, profileView, saveFields, deleteProfile, shirtTaken, samePerson } from '../../_lib/squadProfiles.js';

// GET    /api/squad-portal/profiles/:id                 -- everything to reopen the form (any device)
// PATCH  /api/squad-portal/profiles/:id { changes, since, commit, type? }  -- autosave (later save wins per field)
// DELETE /api/squad-portal/profiles/:id                 -- drafts only
async function checks(env, p) {
  return {
    shirtTaken: p.type === 'player' ? await shirtTaken(env.DB, { season: p.season, number: p.shirt_number, exceptId: p.id }) : null,
    samePerson: await samePerson(env.DB, { surname: p.surname, firstName: p.first_name, dob: p.dob, exceptId: p.id }),
  };
}
export async function onRequestGet({ request, env, params }) {
  const { denied } = await requirePortal(request, env);
  if (denied) return denied;
  const p = await getProfile(env.DB, params.id);
  if (!p) return portalJson({ error: 'Profile not found.' }, 404);
  return portalJson({ profile: profileView(p), ...(await checks(env, p)) });
}
export async function onRequestPatch({ request, env, params }) {
  const { session, denied } = await requirePortal(request, env, { write: true });
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  const r = await saveFields(env, portalActor(session), params.id, { changes: b.changes, since: b.since, commit: !!b.commit, sessionId: session.id, type: b.type || null });
  if (r.error) return portalJson(r, r.status || 400);
  return portalJson({ ...r, ...(await checks(env, await getProfile(env.DB, params.id))) });
}
export async function onRequestDelete({ request, env, params }) {
  const { session, denied } = await requirePortal(request, env, { write: true });
  if (denied) return denied;
  const r = await deleteProfile(env, portalActor(session), params.id);
  return r.error ? portalJson(r, r.status || 400) : portalJson(r);
}
