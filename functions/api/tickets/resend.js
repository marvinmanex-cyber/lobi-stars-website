import { ensureTicketShopSchema, sendBasketEmail } from '../_lib/ticketShop.js';
import { clientIp, rateLimit, tooMany, ensureFanSchema } from '../_lib/fans.js';

// POST /api/tickets/resend { reference } -- "Email my tickets": sends the tickets of an
// order (LSBAS-…) again, with the PDF, ONLY to the email address on the order. Used by
// the tickets screen after booking. 3 per order per hour, 20 per connection per hour.
export async function onRequestPost({ request, env }) {
  try {
    const db = env.DB;
    await ensureFanSchema(db); await ensureTicketShopSchema(db);
    const b = await request.json().catch(() => ({}));
    const ref = String(b.reference || '').trim().toUpperCase();
    if (!/^LSBAS-[A-Z0-9]{6,20}$/.test(ref)) return Response.json({ error: 'Missing order reference.' }, { status: 400 });
    if (!(await rateLimit(db, `ticket-resend-ip:${clientIp(request)}`, 20, 3600))) return tooMany();
    if (!(await rateLimit(db, `ticket-resend:${ref}`, 3, 3600))) return Response.json({ error: 'Your tickets were just sent. Check your inbox and spam folder, or try again in an hour.' }, { status: 429 });
    const basket = await db.prepare(`SELECT * FROM league_ticket_orders WHERE reference = ? AND status = 'paid'`).bind(ref).first();
    if (!basket) return Response.json({ error: 'No confirmed order has that reference.' }, { status: 404 });
    await sendBasketEmail(env, basket);
    const [user, domain] = String(basket.buyer_email).split('@');
    return Response.json({ ok: true, sentTo: `${user.slice(0, 2)}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}` }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[tickets] resend', err);
    return Response.json({ error: 'The email could not be sent just now. Please try again.' }, { status: 500 });
  }
}
