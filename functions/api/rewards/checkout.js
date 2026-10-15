import { readSession } from '../_lib/session.js';
import { checkoutOptions } from '../_lib/rewardsCheckout.js';
import { rewardsSettings } from '../_lib/rewards.js';
import { purchaseMultiplier } from '../_lib/rewardsTiers.js';
import { purchasePoints } from '../_lib/rewardsRules.js';

// GET /api/rewards/checkout?kind=tickets|food|shop&subtotalKobo=&feeKobo=
// For the "Use my Star Points" box on our checkouts: whether the fan can use
// points or a voucher here, how many points (value, limits), their vouchers
// that fit, and how many Star Points this order would earn.
// The server checks everything again when payment starts.
export async function onRequestGet({ request, env }) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const url = new URL(request.url);
    const kind = ['tickets', 'food', 'shop'].includes(url.searchParams.get('kind')) ? url.searchParams.get('kind') : null;
    const subtotal = Math.max(0, Math.floor(Number(url.searchParams.get('subtotalKobo')) || 0));
    if (!kind) return Response.json({ error: 'kind' }, { status: 400, headers });
    const memberId = await readSession(request, env.SESSION_SECRET).catch(() => null);
    const opt = await checkoutOptions(env, memberId, kind, subtotal, { feeKobo: Number(url.searchParams.get('feeKobo')) || 0 });
    const s = await rewardsSettings(env.DB);
    const per100 = { tickets: s.ticketsPer100, food: s.foodPer100, shop: s.shopPer100 }[kind];
    const mult = memberId && opt.available ? await purchaseMultiplier(env.DB, memberId) : 1;
    return Response.json({ ...opt, signedIn: !!memberId, earnPer100: per100, multiplier: mult, earnEstimate: purchasePoints(subtotal, per100, mult) }, { headers });
  } catch (err) {
    console.error('[rewards] checkout options', err);
    return Response.json({ available: false }, { headers });
  }
}
