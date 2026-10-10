import { verifyPayment } from '../_lib/extraPayments.js';
import { PERSONALISATION } from '../_lib/shirtOrders.js';

// GET /api/payments/verify?reference=... -- the page fans return to after
// paying for membership or a personalised shirt. Confirms with Paystack if
// the webhook hasn't arrived yet. Shows only what the buyer needs.
export async function onRequestGet({ request, env, waitUntil }) {
  const reference = new URL(request.url).searchParams.get('reference') || '';
  if (!/^[A-Za-z0-9-]{6,60}$/.test(reference)) return Response.json({ error: 'Missing reference' }, { status: 400 });
  const found = await verifyPayment(env, reference, waitUntil);
  if (!found) return Response.json({ error: 'Payment not found' }, { status: 404 });
  const r = found.row;
  const body = found.kind === 'membership'
    ? { kind: 'membership', paid: found.paid, season: r.season }
    : { kind: 'shirt', paid: found.paid, order: { id: r.id, product: r.product_name, size: r.size, name: r.print_name, number: r.print_number, totalKobo: r.total_kobo }, howYouGetIt: PERSONALISATION.howYouGetIt };
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
