import { listMatches, toSummary } from './_lib/matchCentre.js';
import { notifyOpenPredictions } from './_lib/notify.js';

// GET /api/matches -- every visible match (past and future) with its Match
// Centre slug, status and score. Used by /fixtures, /results and the
// homepage "Next matches" strip.
export async function onRequestGet({ env, waitUntil }) {
  const rows = await listMatches(env.DB);
  // "Predictions are now open" reminder emails, in the background (see notify.js).
  waitUntil(notifyOpenPredictions(env, rows));
  return Response.json(
    { matches: rows.map(r => toSummary(r, r)) },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
