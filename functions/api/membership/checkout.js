import { currentFan } from '../_lib/matchdayFan.js';
import { MEMBERSHIP, ensureMembershipSchema, isMember } from '../_lib/membership.js';
import { seasonConfig } from '../_lib/seasonConfig.js';
import { initializeTransaction } from '../_lib/paystack.js';
import { randomId } from '../_lib/crypto.js';
import { rateLimit, tooMany, clientIp } from '../_lib/fans.js';

// POST /api/membership/checkout -- pay for this season's membership online.
// Only works when online payment is switched on in the CMS (off by default).
export async function onRequestPost({ request, env }) {
  if (!MEMBERSHIP.onlinePayment) return Response.json({ error: 'Online membership payment is not available yet.' }, { status: 404 });
  const fan = await currentFan(request, env);
  if (!fan) return Response.json({ error: 'Please log in first.', code: 'login' }, { status: 401 });
  if (!(await rateLimit(env.DB, `memberpay:${fan.id}:${clientIp(request)}`, 10, 3600))) return tooMany();
  await ensureMembershipSchema(env.DB);
  const { currentSeason } = await seasonConfig(env, request);
  const row = await env.DB.prepare(`SELECT email, membership_season FROM members WHERE id = ?`).bind(fan.id).first();
  if (isMember(row, currentSeason)) return Response.json({ error: `You are already a member for ${currentSeason}.`, code: 'member' }, { status: 409 });

  const id = randomId('LS-MEM');
  const reference = randomId('LSMEM');
  await env.DB.prepare(`INSERT INTO membership_payments (id, member_id, season, amount_kobo, paystack_reference) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, fan.id, currentSeason, MEMBERSHIP.priceKobo, reference).run();
  try {
    const p = await initializeTransaction(env.PAYSTACK_SECRET_KEY, {
      email: row.email, amountKobo: MEMBERSHIP.priceKobo, reference,
      callbackUrl: `${new URL(request.url).origin}/payment/success/`,
      metadata: { kind: 'membership', paymentId: id, season: currentSeason },
    });
    return Response.json({ authorizationUrl: p.authorization_url, reference });
  } catch (err) {
    return Response.json({ error: `Payment could not be started: ${err.message}` }, { status: 502 });
  }
}
