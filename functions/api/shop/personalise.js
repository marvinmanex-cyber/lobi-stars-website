import { PERSONALISATION, personalisableShirts, parseShirtOrder, ensureShirtSchema } from '../_lib/shirtOrders.js';
import { initializeTransaction } from '../_lib/paystack.js';
import { randomId } from '../_lib/crypto.js';
import { rateLimit, tooMany, clientIp } from '../_lib/fans.js';
import { readSession } from '../_lib/session.js';

// GET /api/shop/personalise -- whether personalisation is on, and its options.
export async function onRequestGet() {
  return Response.json({
    enabled: PERSONALISATION.enabled,
    shirts: personalisableShirts(),
    feeKobo: PERSONALISATION.enabled ? PERSONALISATION.feeKobo : null,
    sizes: PERSONALISATION.sizes, maxLetters: PERSONALISATION.maxLetters,
    howYouGetIt: PERSONALISATION.enabled ? PERSONALISATION.howYouGetIt : '',
  }, { headers: { 'Cache-Control': 'public, max-age=60' } });
}

// POST /api/shop/personalise -- starts the Paystack payment for a personalised shirt.
export async function onRequestPost({ request, env }) {
  if (!PERSONALISATION.enabled) return Response.json({ error: 'Shirt personalisation is not available yet.' }, { status: 404 });
  if (!(await rateLimit(env.DB, `shirt:${clientIp(request)}`, 10, 3600))) return tooMany();
  let b;
  try { b = await request.json(); } catch { b = {}; }
  const { value: o, error } = parseShirtOrder(b);
  if (error) return Response.json({ error }, { status: 400 });
  await ensureShirtSchema(env.DB);
  const id = randomId('LS-SHT');
  const reference = randomId('LSSHT');
  const memberId = await readSession(request, env.SESSION_SECRET);
  await env.DB.prepare(
    `INSERT INTO shirt_orders (id, product_id, product_name, size, print_name, print_number, unit_kobo, fee_kobo, total_kobo,
       buyer_name, buyer_email, buyer_phone, member_id, paystack_reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, o.product_id, o.product_name, o.size, o.print_name, o.print_number, o.unit_kobo, o.fee_kobo, o.total_kobo,
    o.buyer_name, o.buyer_email, o.buyer_phone, memberId || null, reference).run();
  try {
    const p = await initializeTransaction(env.PAYSTACK_SECRET_KEY, {
      email: o.buyer_email, amountKobo: o.total_kobo, reference,
      callbackUrl: `${new URL(request.url).origin}/payment/success/`,
      metadata: { kind: 'shirt', orderId: id },
    });
    return Response.json({ authorizationUrl: p.authorization_url, reference, orderId: id });
  } catch (err) {
    return Response.json({ error: `Payment could not be started: ${err.message}` }, { status: 502 });
  }
}
