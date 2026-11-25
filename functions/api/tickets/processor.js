import { ticketingStatus } from '../_lib/ticketing/engineStore.js';

// GET /api/tickets/processor -- the legal name of the company that receives ticket payments,
// shown on the Terms and Privacy pages while ticket sales run through the ticketing engine
// (honesty rule: fans are told who receives the money). { name: null } otherwise.
export async function onRequestGet({ env }) {
  try {
    const s = await ticketingStatus(env);
    return Response.json({ name: s.active === 'engine' ? s.processorName : null }, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch {
    return Response.json({ name: null }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
