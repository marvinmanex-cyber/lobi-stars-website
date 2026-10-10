import { readSession } from '../_lib/session.js';
import { ensureFanSchema } from '../_lib/fans.js';
import { ensureMembershipSchema, isMember, MEMBERSHIP } from '../_lib/membership.js';
import { seasonConfig } from '../_lib/seasonConfig.js';

export async function onRequestGet({ request, env }) {
  const memberId = await readSession(request, env.SESSION_SECRET);
  if (!memberId) return Response.json({ member: null });

  await ensureFanSchema(env.DB);
  await ensureMembershipSchema(env.DB);
  const member = await env.DB.prepare(
    `SELECT id, first_name, last_name, email, tier, email_verified, membership_season, membership_since FROM members WHERE id = ?`
  ).bind(memberId).first();
  if (!member) return Response.json({ member: null });
  const { currentSeason } = await seasonConfig(env, request);
  const active = isMember(member, currentSeason);

  return Response.json({
    member: {
      id: member.id, firstName: member.first_name, lastName: member.last_name, email: member.email,
      tier: member.tier, emailVerified: !!member.email_verified,
      // Official membership for the current season (confirmed by staff or paid online).
      membership: {
        season: currentSeason, active, since: active ? member.membership_since : null,
        onlinePayment: MEMBERSHIP.onlinePayment, priceKobo: MEMBERSHIP.priceKobo, howToPay: MEMBERSHIP.howToPay,
      },
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
