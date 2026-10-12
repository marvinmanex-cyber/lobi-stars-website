import { randomId } from '../_lib/crypto.js';
import { initialize } from '../_lib/paystackClient.js';
import { seasonSettings, availability, TIERS, MAX_PER_ORDER } from '../_lib/seasonTickets.js';
import { seasonConfig } from '../_lib/seasonConfig.js';
import { normalizeNigerianPhone, clientIp, rateLimit, tooMany, ensureFanSchema } from '../_lib/fans.js';

// POST /api/season-tickets/checkout { tier, quantity, buyerName, buyerEmail, buyerPhone }
// -> { authorizationUrl, reference } (Paystack). The price always comes from
// the server; stands with a limit cannot be oversold (unpaid orders hold
// their places for 30 minutes).
export async function onRequestPost({ request, env }) {
  try {
    const b = await request.json().catch(() => ({}));
    await ensureFanSchema(env.DB);
    if (!(await rateLimit(env.DB, `season-checkout:${clientIp(request)}`, 10, 3600))) return tooMany();
    const s = await seasonSettings(env.DB, (await seasonConfig(env, request)).currentSeason);
    if (!s.enabled) return Response.json({ error: 'Season tickets are not on sale.' }, { status: 409 });
    const tier = String(b.tier || '');
    const qty = Number.parseInt(b.quantity, 10);
    const name = String(b.buyerName || '').replace(/<[^>]*>/g, '').trim().slice(0, 80);
    const email = String(b.buyerEmail || '').trim().toLowerCase();
    const phone = normalizeNigerianPhone(b.buyerPhone);
    if (!TIERS.includes(tier)) return Response.json({ error: 'Choose a stand.' }, { status: 400 });
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_PER_ORDER) return Response.json({ error: `You can buy 1 to ${MAX_PER_ORDER} season tickets at a time.` }, { status: 400 });
    if (name.length < 2) return Response.json({ error: 'Please enter your full name.' }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) return Response.json({ error: 'Please enter a valid email address.' }, { status: 400 });
    if (!phone) return Response.json({ error: 'Please enter a valid Nigerian mobile number.' }, { status: 400 });

    const avail = (await availability(env.DB, s))[tier];
    if (!avail.onSale) return Response.json({ error: 'That stand is not on sale.' }, { status: 409 });
    if (avail.limit && avail.remaining < qty) return Response.json({ error: avail.remaining ? `Only ${avail.remaining} left in the ${avail.label}.` : `The ${avail.label} is sold out.` }, { status: 409 });

    const id = randomId('LS-SZO');
    const reference = randomId('LSSZN');
    const total = avail.priceKobo * qty;
    await env.DB.prepare(`INSERT INTO season_orders (id, season, tier, quantity, unit_price_kobo, total_kobo, buyer_name, buyer_email, buyer_phone, paystack_reference)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, s.season, tier, qty, avail.priceKobo, total, name, email, phone, reference).run();
    const origin = new URL(request.url).origin;
    let p;
    try {
      p = await initialize(env, { email, amountKobo: total, reference, callbackUrl: `${origin}/season-tickets/success/`, metadata: { kind: 'season', orderId: id, season: s.season, tier, quantity: qty } });
    } catch (err) {
      await env.DB.prepare(`UPDATE season_orders SET payment_status = 'failed' WHERE id = ?`).bind(id).run();
      return Response.json({ error: 'Payment could not be started. Please try again.' }, { status: 502 });
    }
    return Response.json({ authorizationUrl: p.authorization_url, reference });
  } catch (err) {
    console.error('[season] checkout', err);
    return Response.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
