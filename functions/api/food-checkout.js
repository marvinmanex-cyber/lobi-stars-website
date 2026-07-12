import { randomId } from './_lib/crypto.js';
import { initializeTransaction } from './_lib/paystack.js';
import { FOOD_MENU } from './_lib/foodMenu.js';

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { seat, stand, phone, email, items } = body || {};

  if (!seat || !phone || !email || !Array.isArray(items) || !items.length) {
    return Response.json({ error: 'Missing or invalid required fields' }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: 'Invalid email address' }, { status: 400 });
  }

  const orderItems = [];
  let totalKobo = 0;

  for (const item of items) {
    const menuItem = FOOD_MENU[item?.id];
    const qty = Number.parseInt(item?.qty, 10);
    if (!menuItem || !Number.isInteger(qty) || qty < 1 || qty > 50) {
      return Response.json({ error: `Invalid item or quantity: ${item?.id}` }, { status: 400 });
    }
    orderItems.push({ id: item.id, name: menuItem.name, priceKobo: menuItem.priceKobo, qty });
    totalKobo += menuItem.priceKobo * qty;
  }

  const orderId = randomId('LS-FOOD');
  const reference = randomId('LSFOOD');

  await env.DB.prepare(
    `INSERT INTO food_orders (id, seat, stand, phone, email, items_json, total_kobo, paystack_reference, payment_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
  ).bind(orderId, seat, stand || null, phone, email, JSON.stringify(orderItems), totalKobo, reference).run();

  const origin = new URL(request.url).origin;

  let paystack;
  try {
    paystack = await initializeTransaction(env.PAYSTACK_SECRET_KEY, {
      email,
      amountKobo: totalKobo,
      reference,
      callbackUrl: `${origin}/food/success`,
      metadata: { orderId, seat, stand },
    });
  } catch (err) {
    return Response.json({ error: `Payment initialization failed: ${err.message}` }, { status: 502 });
  }

  return Response.json({
    authorizationUrl: paystack.authorization_url,
    reference,
    orderId,
  });
}
