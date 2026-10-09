import { listMatches, toSummary } from './_lib/matchCentre.js';

// GET /api/matches -- every visible match (past and future) with its Match
// Centre slug, status and score. Used by /fixtures, /results and the
// homepage "Next matches" strip.
export async function onRequestGet({ env }) {
  const rows = await listMatches(env.DB);
  return Response.json(
    { matches: rows.map(r => toSummary(r, r)) },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
