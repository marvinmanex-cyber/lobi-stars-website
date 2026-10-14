import { currentTerms } from '../_lib/rewardsTerms.js';

// GET /api/rewards/terms -- the current Lobi Stars Rewards Terms (as saved in
// Admin › Rewards › Terms, or the approved default): { body, updated }.
export async function onRequestGet({ env }) {
  try {
    const t = await currentTerms(env.DB);
    return Response.json({ body: t.body, updated: t.updated, custom: t.custom }, { headers: { 'Cache-Control': 'public, max-age=60' } });
  } catch (err) {
    console.error('[rewards] terms', err);
    return Response.json({ error: 'Could not load the terms.' }, { status: 500 });
  }
}
