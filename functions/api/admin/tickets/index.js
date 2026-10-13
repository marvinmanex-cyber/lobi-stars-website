import { ticketAuth, ok, fail, salesView } from '../../_lib/ticketAdmin.js';

// GET /api/admin/tickets -- every home match: prices, capacity per stand,
// sale times, on/off, tickets sold, revenue and seats left; plus totals.
export async function onRequestGet({ request, env }) {
  const { denied } = await ticketAuth(request, env);
  if (denied) return denied;
  try {
    const matches = await salesView(env);
    const totals = matches.reduce((t, m) => {
      for (const x of m.tiers) { t.sold += x.sold; t.revenueKobo += x.revenueKobo; if (x.capacity !== null) t.capacity += x.capacity; }
      return t;
    }, { sold: 0, revenueKobo: 0, capacity: 0 });
    return ok({ matches, totals });
  } catch (err) {
    console.error('[tickets admin] view', err);
    return fail('Could not load ticket sales.', 500);
  }
}
