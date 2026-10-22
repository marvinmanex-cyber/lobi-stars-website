import { requirePortal, portalJson } from '../_lib/squadPortal.js';
import { shirtTaken } from '../_lib/squadProfiles.js';

// GET /api/squad-portal/check?number=9&id=… -- is this shirt number already assigned this season (live check while typing).
export async function onRequestGet({ request, env }) {
  const { session, denied } = await requirePortal(request, env);
  if (denied) return denied;
  const u = new URL(request.url);
  return portalJson({ taken: await shirtTaken(env.DB, { season: u.searchParams.get('season') || session.season, number: Number(u.searchParams.get('number')), exceptId: u.searchParams.get('id') }) });
}
