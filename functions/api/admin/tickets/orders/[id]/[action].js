import { ticketAuth, ok, fail } from '../../../../_lib/ticketAdmin.js';
import { sendBasketEmail } from '../../../../_lib/ticketShop.js';
import { sendEmail, ticketEmailHtml } from '../../../../_lib/email.js';
import { logLeague } from '../../../../_lib/leagueDb.js';
import { reversePoints } from '../../../../_lib/rewardsEarn.js';

// POST /api/admin/tickets/orders/:id/resend  -- email the tickets again
// POST /api/admin/tickets/orders/:id/refund  { reason } -- mark refunded and
//      cancel its tickets (the money itself is refunded in the Paystack dashboard)
export async function onRequestPost({ request, env, params }) {
  const { staff, denied } = await ticketAuth(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    const id = String(params.id || '');
    const basket = await db.prepare(`SELECT * FROM league_ticket_orders WHERE id = ?`).bind(id).first();
    const single = basket ? null : await db.prepare(`SELECT * FROM orders WHERE id = ? AND basket_id IS NULL`).bind(id).first();
    if (!basket && !single) return fail('Order not found.', 404);
    const paid = basket ? basket.status === 'paid' : single.payment_status === 'paid' && !single.refunded_at;

    if (params.action === 'resend') {
      if (!paid) return fail('Only paid orders have tickets to send.', 409);
      if (!env.RESEND_API_KEY) return fail('Email is not set up yet (Resend).', 409);
      if (basket) await sendBasketEmail(env, basket);
      else {
        const event = await db.prepare(`SELECT * FROM events WHERE id = ?`).bind(single.event_id).first();
        const { results: tickets } = await db.prepare(`SELECT id FROM tickets WHERE order_id = ? AND status != 'void'`).bind(single.id).all();
        await sendEmail(env, { to: single.buyer_email, subject: `Your Lobi Stars tickets -- ${event.home_team} vs ${event.away_team}`, html: ticketEmailHtml({ order: single, event, tickets }) });
      }
      await logLeague(db, staff, 'tickets.resend', 'tickets', id, null, { to: basket ? basket.buyer_email : single.buyer_email });
      return ok();
    }

    if (params.action === 'refund') {
      if (!paid) return fail('Only paid orders can be marked refunded.', 409);
      const reason = String((await request.json().catch(() => ({}))).reason || '').trim().slice(0, 200);
      if (reason.length < 3) return fail('Give the reason for the refund.');
      const orderIds = basket ? (await db.prepare(`SELECT id FROM orders WHERE basket_id = ?`).bind(id).all()).results.map(r => r.id) : [single.id];
      const stmts = orderIds.flatMap(oid => [
        db.prepare(`UPDATE orders SET refunded_at = datetime('now') WHERE id = ?`).bind(oid),
        // Unused tickets stop working at the gate; used ones stay as a record.
        db.prepare(`UPDATE tickets SET status = 'void' WHERE order_id = ? AND status = 'valid'`).bind(oid),
      ]);
      if (basket) stmts.push(db.prepare(`UPDATE league_ticket_orders SET status = 'refunded', refunded_at = datetime('now') WHERE id = ?`).bind(id));
      await db.batch(stmts);
      await logLeague(db, staff, 'tickets.refund', 'tickets', id, { status: 'paid' }, { status: 'refunded', reason });
      // Lobi Stars Rewards: take back the points of these tickets (pending ones are cancelled).
      for (const oid of orderIds) await reversePoints(env, { source: 'ticket_order', ref: oid }, 'tickets refunded');
      return ok();
    }
    return fail('Unknown action.', 404);
  } catch (err) {
    console.error('[tickets admin] order action', err);
    return fail('Could not do that.', 500);
  }
}
