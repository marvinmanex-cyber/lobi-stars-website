import { sendEmail, foodOrderEmailHtml } from './email.js';

// Marks a food order paid and sends the confirmation email. Safe to call
// more than once for the same order (webhook + success-page verify can
// both race to fulfill it) -- the atomic UPDATE ensures only one caller
// actually sends the email.
export async function fulfillFoodOrder(env, order, waitUntil) {
  if (order.payment_status === 'paid') {
    return order;
  }

  const updateResult = await env.DB.prepare(
    `UPDATE food_orders SET payment_status = 'paid', paid_at = datetime('now') WHERE id = ? AND payment_status != 'paid'`
  ).bind(order.id).run();

  if (!updateResult.meta.changes) {
    // Someone else just won the race -- their email send is in flight.
    return { ...order, payment_status: 'paid' };
  }

  const items = JSON.parse(order.items_json);

  const sendConfirmation = () =>
    sendEmail(env, {
      to: order.email,
      subject: 'Your Lobi Stars in-seat food order',
      html: foodOrderEmailHtml({ order, items }),
    }).catch(err => console.error('Food order email failed:', err));

  if (waitUntil) {
    waitUntil(sendConfirmation());
  } else {
    await sendConfirmation();
  }

  return { ...order, payment_status: 'paid' };
}
