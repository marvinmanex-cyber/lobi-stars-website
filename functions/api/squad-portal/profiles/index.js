import { requirePortal, portalJson, portalActor } from '../../_lib/squadPortal.js';
import { listProfiles, counts, seasons, createProfile } from '../../_lib/squadProfiles.js';

// GET  /api/squad-portal/profiles?season=&filter=&q=  -- saved profiles, counts, seasons
// POST /api/squad-portal/profiles { type }             -- a new draft (when the type is chosen)
export async function onRequestGet({ request, env }) {
  const { session, denied } = await requirePortal(request, env);
  if (denied) return denied;
  const u = new URL(request.url);
  const season = u.searchParams.get('season') || session.season;
  return portalJson({ season, current: session.season, seasons: await seasons(env.DB), counts: await counts(env.DB, season),
    profiles: await listProfiles(env.DB, { season, filter: u.searchParams.get('filter') || 'all', q: u.searchParams.get('q') || '' }) });
}
export async function onRequestPost({ request, env }) {
  const { session, denied } = await requirePortal(request, env, { write: true });
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  const r = await createProfile(env, portalActor(session), { type: b.type, season: session.season });
  return r.error ? portalJson(r, 400) : portalJson(r);
}
