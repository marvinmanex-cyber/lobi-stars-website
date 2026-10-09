import { ensureTable } from '../_lib/matchCentre.js';
import { awardCounts } from '../_lib/motm.js';

// GET /api/motm/awards -- { awards: { [playerSlug]: count } }: how many times
// each player has been voted Man of the Match. Shown on player profiles.
export async function onRequestGet({ env }) {
  await ensureTable(env.DB);
  return Response.json({ awards: await awardCounts(env.DB) }, { headers: { 'Cache-Control': 'public, max-age=120' } });
}
