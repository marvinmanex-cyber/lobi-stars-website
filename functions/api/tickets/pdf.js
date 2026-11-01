import { ensureTicketShopSchema } from '../_lib/ticketShop.js';
import { ensureDiscountSchema } from '../_lib/ticketDiscounts.js';
import { basketTickets } from './basket.js';
import { ticketsPdf } from '../_lib/ticketPdf.js';
import { clientIp, rateLimit, tooMany, ensureFanSchema } from '../_lib/fans.js';

// GET /api/tickets/pdf?reference=LSBAS-…[&ticket=LS-TIX-…]
//   The paid tickets of a basket as a PDF (one page per ticket), the same file
//   that is attached to the ticket email. Same access as /api/tickets/basket:
//   whoever holds the order reference. ticket= gives just that one ticket.
// GET /api/tickets/pdf?reference=LSPAY-…|LS-ORD-…&email=  -- single-match
//   orders bought before baskets (the email they paid with is needed, as on
//   the ticket lookup page).
export async function onRequestGet({ request, env }) {
  try {
    const db = env.DB;
    await ensureFanSchema(db);
    if (!(await rateLimit(db, `ticket-pdf:${clientIp(request)}`, 30, 900))) return tooMany();
    await ensureTicketShopSchema(db);
    await ensureDiscountSchema(db);
    const q = new URL(request.url).searchParams;
    const ref = String(q.get('reference') || '').trim().toUpperCase().slice(0, 40);
    const only = String(q.get('ticket') || '').trim().toUpperCase().slice(0, 60);
    const notFound = Response.json({ error: 'No paid order matches that reference.' }, { status: 404 });
    let data;
    if (/^LSBAS-[A-Z0-9]{6,20}$/.test(ref)) {
      const basket = await db.prepare(`SELECT * FROM league_ticket_orders WHERE reference = ? AND status = 'paid'`).bind(ref).first();
      if (!basket) return notFound;
      data = await basketTickets(db, basket);
    } else {
      const email = String(q.get('email') || '').trim().toLowerCase().slice(0, 254);
      if (!/^[A-Z0-9-]{8,40}$/.test(ref) || !email) return notFound;
      const o = await db.prepare(`SELECT o.*, e.home_team, e.away_team, e.event_date, e.venue FROM orders o JOIN events e ON e.id = o.event_id
        WHERE (o.paystack_reference = ? OR o.id = ?) AND lower(o.buyer_email) = ? AND o.payment_status = 'paid'`).bind(ref, ref, email).first();
      if (!o) return notFound;
      const { results: t } = await db.prepare(`SELECT id, status, ticket_type FROM tickets WHERE order_id = ? ORDER BY id`).bind(o.id).all();
      const priceKobo = o.quantity ? Math.round(o.total_kobo / o.quantity) : null;
      data = { reference: o.paystack_reference || o.id, matches: [{ homeTeam: o.home_team, awayTeam: o.away_team, kickoff: o.event_date, venue: o.venue, tier: o.tier, tickets: t.map(x => ({ id: x.id, status: x.status, type: x.ticket_type || 'adult', priceKobo })) }] };
    }
    if (only) data.matches = data.matches.map(m => ({ ...m, tickets: m.tickets.filter(t => t.id === only) })).filter(m => m.tickets.length);
    const pdf = await ticketsPdf(env, data);
    if (!pdf) return notFound;
    const name = only ? `Lobi-Stars-ticket-${only}.pdf` : `Lobi-Stars-tickets-${data.reference}.pdf`;
    return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, '')}"`, 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('[tickets] pdf', err);
    return Response.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
