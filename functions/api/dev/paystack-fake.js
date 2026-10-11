import { isFake, setFakeTransaction } from '../_lib/paystackClient.js';

// POST /api/dev/paystack-fake -- LOCAL TESTS ONLY (when PAYSTACK_FAKE=1).
//   { reference, status, amount, currency }  -> what "Paystack" reports for a payment
//   { action: 'age', ref, minutes }          -> make an order look older (expiry tests)
// Returns 404 on the live site.
export async function onRequestPost({ request, env }) {
  if (!isFake(env)) return new Response('Not found', { status: 404 });
  const b = await request.json().catch(() => ({}));
  if (b.action === 'age') {
    const ms = Number(b.minutes || 0) * 60_000;
    const o = await env.DB.prepare(`SELECT id, created_iso, expires_at FROM food_orders WHERE ref = ?`).bind(String(b.ref || '')).first();
    if (!o) return Response.json({ error: 'no order' }, { status: 404 });
    await env.DB.prepare(`UPDATE food_orders SET created_iso = ?, expires_at = ? WHERE id = ?`)
      .bind(new Date(Date.parse(o.created_iso) - ms).toISOString(), new Date(Date.parse(o.expires_at) - ms).toISOString(), o.id).run();
    return Response.json({ ok: true });
  }
  await setFakeTransaction(env, { reference: String(b.reference || ''), status: b.status || 'success', amount: Number(b.amount) || 0, currency: b.currency || 'NGN' });
  return Response.json({ ok: true });
}
