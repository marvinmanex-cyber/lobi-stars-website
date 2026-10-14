import { ensureTicketShopSchema } from '../_lib/ticketShop.js';
import { ensureDiscountSchema } from '../_lib/ticketDiscounts.js';
import { basketTickets } from './basket.js';
import { clientIp, rateLimit, tooMany, ensureFanSchema } from '../_lib/fans.js';

// POST /api/tickets/lookup { email, reference } -- re-open your tickets with
// the email you paid with and the order reference (LSBAS-…, LSPAY-… or LS-ORD-…).
// 5 tries per 15 minutes per address, 20 per email per day.
export async function onRequestPost({ request, env }) {
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

    const basket = await db.prepare(`SELECT * FROM league_ticket_orders WHERE reference = ? AND lower(buyer_email) = ? AND status IN ('paid', 'refunded')`).bind(ref, email).first();
    if (basket) return Response.json({ kind: 'basket', ...(await basketTickets(db, basket)) });

    // Single-match orders bought before (reference LSPAY-… or order id LS-ORD-…).
    const o = await db.prepare(`SELECT o.*, e.home_team, e.away_team, e.event_date, e.venue, (SELECT id FROM league_fixtures f WHERE f.event_id = o.event_id) AS fixture_id
      FROM orders o JOIN events e ON e.id = o.event_id WHERE (o.paystack_reference = ? OR o.id = ?) AND lower(o.buyer_email) = ? AND o.payment_status = 'paid'`).bind(ref, ref, email).first();
    if (!o) return notFound;
    const { results: t } = await db.prepare(`SELECT id, status FROM tickets WHERE order_id = ? ORDER BY id`).bind(o.id).all();
    return Response.json({ kind: 'order', reference: o.paystack_reference, email, totalKobo: o.total_kobo,
      matches: [{ eventId: o.event_id, homeTeam: o.home_team, awayTeam: o.away_team, kickoff: o.event_date, venue: o.venue, tier: o.tier, fixtureId: o.fixture_id, tickets: t.map(x => ({ id: x.id, status: x.status })) }] });
  } catch (err) {
    console.error('[tickets] lookup', err);
    return Response.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
