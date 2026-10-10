import { onSaleEvents } from './_lib/onSale.js';

// GET /api/events -- lists active purchasable matches with seat tier pricing.
// (Kick-off times are stored as ISO strings, so "now" is compared in the same
// format; a match drops off the list as soon as it kicks off.)
export async function onRequestGet({ env }) {
  return Response.json({ events: await onSaleEvents(env.DB) });
}
