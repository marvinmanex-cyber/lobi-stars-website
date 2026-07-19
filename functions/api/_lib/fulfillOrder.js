import { randomId } from './crypto.js';
import { sendEmail, ticketEmailHtml } from './email.js';

// Marks an order paid and issues its tickets. Safe to call more than once
// for the same order (e.g. from both the webhook and the success-page
// verify call) -- if it's already paid, this is a no-op that just returns
// the existing tickets.
export async function fulfillOrder(env, order, waitUntil) {
  if (order.payment_status === 'paid') {
    const { results } = await env.DB.prepare(`SELECT * FROM tickets WHERE order_id = ?`).bind(order.id).all();
    return results;
  }

  // Atomic claim: only the caller whose UPDATE actually flips pending->paid
  // proceeds to issue tickets. If two requests race (webhook + success-page
  // verify), the loser sees changes=0 and just reads back what the winner
  // created, so tickets are never issued twice for one order.
  const updateResult = await env.DB.prepare(
    `UPDATE orders SET payment_status = 'paid', paid_at = datetime('now') WHERE id = ? AND payment_status != 'paid'`
  ).bind(order.id).run();

  if (!updateResult.meta.changes) {
    // Someone else just won the race; poll briefly for their tickets to land.
    for (let i = 0; i < 5; i++) {
      const { results } = await env.DB.prepare(`SELECT * FROM tickets WHERE order_id = ?`).bind(order.id).all();
      if (results.length) return results;
      await new Promise(r => setTimeout(r, 200));
    }
    return [];
  }

  const ticketIds = Array.from({ length: order.quantity }, () => randomId('LS-TIX', 12));
  const insertTicket = env.DB.prepare(
    `INSERT INTO tickets (id, order_id, event_id, tier, status) VALUES (?, ?, ?, ?, 'valid')`
  );
  await env.DB.batch(ticketIds.map(id => insertTicket.bind(id, order.id, order.event_id, order.tier)));

  const tickets = ticketIds.map(id => ({ id }));
  const eventRow = await env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(order.event_id).first();

  const sendConfirmation = () =>
    sendEmail(env, {
      to: order.buyer_email,
      subject: `Your Lobi Stars tickets -- ${eventRow.home_team} vs ${eventRow.away_team}`,
      html: ticketEmailHtml({ order, event: eventRow, tickets }),
    }).catch(err => console.error('Ticket email failed:', err));

  if (waitUntil) {
    waitUntil(sendConfirmation());
  } else {
    await sendConfirmation();
  }

  return tickets;
}
