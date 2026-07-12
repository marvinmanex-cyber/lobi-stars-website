import { randomId } from './_lib/crypto.js';
import { verifyWebhookSignature } from './_lib/paystack.js';
import { sendEmail, ticketEmailHtml } from './_lib/email.js';
import { qrSvgDataUri } from './_lib/qrcode.js';

// POST /api/paystack-webhook -- Paystack calls this server-to-server after a
// payment attempt. This (not the browser redirect) is the source of truth
// for marking an order paid and issuing tickets, since a buyer can close
// their browser before the redirect completes.
export async function onRequestPost({ request, env, waitUntil }) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-paystack-signature');

  const validSig = await verifyWebhookSignature(env.PAYSTACK_SECRET_KEY, rawBody, signature);
  if (!validSig) {
    return new Response('Invalid signature', { status: 401 });
  }

  const event = JSON.parse(rawBody);
  if (event.event !== 'charge.success') {
    return new Response('Ignored', { status: 200 });
  }

  const { reference, amount } = event.data;

  const order = await env.DB.prepare(
    `SELECT * FROM orders WHERE paystack_reference = ?`
  ).bind(reference).first();

  if (!order) {
    return new Response('Order not found', { status: 404 });
  }
  if (order.payment_status === 'paid') {
    return new Response('Already processed', { status: 200 }); // idempotent
  }
  if (amount !== order.total_kobo) {
    return new Response('Amount mismatch', { status: 400 });
  }

  await env.DB.prepare(
    `UPDATE orders SET payment_status = 'paid', paid_at = datetime('now') WHERE id = ?`
  ).bind(order.id).run();

  const ticketRows = [];
  for (let i = 0; i < order.quantity; i++) {
    ticketRows.push(randomId('LS-TIX', 12));
  }
  const insertTicket = env.DB.prepare(
    `INSERT INTO tickets (id, order_id, event_id, tier, status) VALUES (?, ?, ?, ?, 'valid')`
  );
  await env.DB.batch(ticketRows.map(id => insertTicket.bind(id, order.id, order.event_id, order.tier)));

  const eventRow = await env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(order.event_id).first();

  waitUntil(
    sendEmail(env, {
      to: order.buyer_email,
      subject: `Your Lobi Stars tickets -- ${eventRow.home_team} vs ${eventRow.away_team}`,
      html: ticketEmailHtml({
        order,
        event: eventRow,
        tickets: ticketRows.map(id => ({ id })),
        qrSvgDataUri,
      }),
    }).catch(err => console.error('Ticket email failed:', err))
  );

  return new Response('OK', { status: 200 });
}
