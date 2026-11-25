import { ensureTicketShopSchema } from '../_lib/ticketShop.js';
import { ensureDiscountSchema } from '../_lib/ticketDiscounts.js';
import { basketTickets } from './basket.js';
import { clientIp, rateLimit, tooMany, ensureFanSchema } from '../_lib/fans.js';
import { engine } from '../_lib/ticketing/engineClient.js';
import { ensureEngineSchema, engineActive, processorName, logTicketing } from '../_lib/ticketing/engineStore.js';
import { storeTickets, pollEngineOrder } from '../_lib/ticketing/engineOrders.js';

// Every answer takes at least this long, found or not (no guessing from the timing).
const MIN_MS = 450;

// POST /api/tickets/lookup { email, reference } -- re-open your tickets with
// the email you paid with and the order reference (LSBAS-…, LSPAY-… or LS-ORD-…).
// 5 tries per 15 minutes per address, 20 per email per day.
export async function onRequestPost(ctx) {
  const t0 = Date.now();
  const res = await lookup(ctx);
  const wait = MIN_MS - (Date.now() - t0);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  return res;
}

async function lookup({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    await ensureFanSchema(db);
    await ensureTicketShopSchema(db);
    await ensureDiscountSchema(db);
    const b = await request.json().catch(() => ({}));
    const email = String(b.email || '').trim().toLowerCase().slice(0, 254);
    const ref = String(b.reference || '').trim().toUpperCase().slice(0, 40);
    if (!(await rateLimit(db, `ticket-lookup:${clientIp(request)}`, 5, 900))) return tooMany();
    if (email && !(await rateLimit(db, `ticket-lookup-email:${email}`, 20, 86400))) return tooMany();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || !/^[A-Z0-9-]{8,40}$/.test(ref)) return Response.json({ error: 'Enter the email you paid with and your order reference.' }, { status: 400 });
    const notFound = Response.json({ error: 'No paid order matches that email and reference.' }, { status: 404 });

    // Ticketing engine mode: the engine is asked first (POST /tickets/lookup) and the local copy is brought up to date.
    await ensureEngineSchema(db);
    if (await engineActive(env)) {
      let tickets = [];
      try { const d = await engine.lookup(env, email, ref); tickets = Array.isArray(d?.tickets) ? d.tickets : []; }
      catch (err) { await logTicketing(env, 'error', 'lookup_failed', { code: err.code, status: err.status }); }
      let eb = await db.prepare(`SELECT * FROM league_ticket_orders WHERE reference = ? AND lower(buyer_email) = ? AND backend = 'engine'`).bind(ref, email).first();
      if (eb && eb.status === 'pending') eb = await pollEngineOrder(env, eb, { waitUntil });
      if (eb && tickets.length && ['paid', 'refunded'].includes(eb.status)) await storeTickets(env, eb, tickets).catch(err => console.error('[tickets] lookup sync', err));
    }
    const basket = await db.prepare(`SELECT * FROM league_ticket_orders WHERE reference = ? AND lower(buyer_email) = ? AND status IN ('paid', 'refunded')`).bind(ref, email).first();
    if (basket) return Response.json({ kind: 'basket', ...(await basketTickets(db, basket)), processedBy: basket.backend === 'engine' && basket.total_kobo > 0 ? (await processorName(db)) || null : null });

    // Single-match orders bought before (reference LSPAY-… or order id LS-ORD-…).
    const o = await db.prepare(`SELECT o.*, e.home_team, e.away_team, e.event_date, e.venue, (SELECT id FROM league_fixtures f WHERE f.event_id = o.event_id) AS fixture_id
      FROM orders o JOIN events e ON e.id = o.event_id WHERE (o.paystack_reference = ? OR o.id = ?) AND lower(o.buyer_email) = ? AND o.payment_status = 'paid'`).bind(ref, ref, email).first();
    if (!o) return notFound;
    const { results: t } = await db.prepare(`SELECT id, status, ticket_type FROM tickets WHERE order_id = ? ORDER BY id`).bind(o.id).all();
    const priceKobo = o.quantity ? Math.round(o.total_kobo / o.quantity) : null;
    return Response.json({ kind: 'order', reference: o.paystack_reference, email, totalKobo: o.total_kobo,
      matches: [{ eventId: o.event_id, homeTeam: o.home_team, awayTeam: o.away_team, kickoff: o.event_date, venue: o.venue, tier: o.tier, fixtureId: o.fixture_id, tickets: t.map(x => ({ id: x.id, status: x.status, type: x.ticket_type || 'adult', priceKobo })) }] });
  } catch (err) {
    console.error('[tickets] lookup', err);
    return Response.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
