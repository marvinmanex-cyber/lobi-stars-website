import { listMatches, toSummary } from './_lib/matchCentre.js';
import { decorateMatches } from './_lib/ticketShop.js';
import { notifyOpenPredictions } from './_lib/notify.js';

// GET /api/matches -- every visible match (past and future) with its Match
// Centre slug, status and score. Used by /fixtures, /results and the
// homepage "Next matches" strip.
export async function onRequestGet({ env, waitUntil }) {
  const rows = await listMatches(env.DB);
  // "Predictions are now open" reminder emails, in the background (see notify.js).
  waitUntil(notifyOpenPredictions(env, rows));
  // + ticket state and league matchday (on_sale follows the Tickets on/off switch).
  const matches = (await decorateMatches(env, rows.map(r => toSummary(r, r)), rows)).map(m => (m.ticket ? { ...m, on_sale: m.ticket.state === 'on_sale' } : m));
  return Response.json(
    { matches },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
