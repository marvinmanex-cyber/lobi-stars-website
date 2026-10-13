import { ticketAuth, ok, fail } from '../../../_lib/ticketAdmin.js';

// GET /api/admin/tickets/orders?q=&event=&status=&page=
// Ticket orders (one row per payment: several matches bought together are one
// order), newest first. q matches name, email, phone or reference.
export async function onRequestGet({ request, env }) {
  const { denied } = await ticketAuth(request, env);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 80);
    const ev = url.searchParams.get('event') || '';
    const status = url.searchParams.get('status') || '';
    if (status && !['pending', 'paid', 'failed', 'refunded'].includes(status)) return fail('Unknown status.');
    const page = Math.max(1, Math.min(200, Number(url.searchParams.get('page')) || 1));
    const { results } = await env.DB.prepare(listSql(q, ev, status) + ` LIMIT 50 OFFSET ?`).bind(...listBinds(q, ev, status), (page - 1) * 50).all();
    return ok({ orders: results.map(shape), page });
  } catch (err) {
    console.error('[tickets admin] orders', err);
    return fail('Could not load the orders.', 500);
  }
}

// One payment = a basket (several matches) or a single-match order.
export function listSql(q, ev, status) {
  const where = [];
  if (q) where.push(`(lower(buyer_name) LIKE ? OR lower(buyer_email) LIKE ? OR buyer_phone LIKE ? OR lower(reference) LIKE ?)`);
  if (ev) where.push(`id IN (SELECT COALESCE(basket_id, id) FROM orders WHERE event_id = ?)`);
  if (status) where.push(`status = ?`);
  return `SELECT * FROM (
      SELECT b.id, b.reference, b.buyer_name, b.buyer_email, b.buyer_phone, b.total_kobo, b.status, b.created_at, b.paid_at, 'basket' AS kind,
        (SELECT COUNT(*) FROM orders o WHERE o.basket_id = b.id) AS matches,
        (SELECT COUNT(*) FROM tickets t JOIN orders o ON o.id = t.order_id WHERE o.basket_id = b.id) AS tickets,
        (SELECT group_concat(e.away_team, ', ') FROM orders o JOIN events e ON e.id = o.event_id WHERE o.basket_id = b.id) AS opponents
      FROM league_ticket_orders b
      UNION ALL
      SELECT o.id, o.paystack_reference, o.buyer_name, o.buyer_email, o.buyer_phone, o.total_kobo,
        CASE WHEN o.refunded_at IS NOT NULL THEN 'refunded' ELSE o.payment_status END, o.created_at, o.paid_at, 'single',
        1, (SELECT COUNT(*) FROM tickets t WHERE t.order_id = o.id), e.away_team
      FROM orders o JOIN events e ON e.id = o.event_id WHERE o.basket_id IS NULL
    ) ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC`;
}
export function listBinds(q, ev, status) {
  const b = [];
  if (q) b.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  if (ev) b.push(ev);
  if (status) b.push(status);
  return b;
}
export const shape = r => ({ id: r.id, kind: r.kind, reference: r.reference, name: r.buyer_name, email: r.buyer_email, phone: r.buyer_phone, totalKobo: r.total_kobo, status: r.status, createdAt: r.created_at, paidAt: r.paid_at, matches: r.matches, tickets: r.tickets, opponents: r.opponents });
