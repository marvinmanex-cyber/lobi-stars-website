import { readSession } from '../_lib/session.js';
import { ensureFanSchema } from '../_lib/fans.js';
import { ensureRewardsSchema, rewardsMember, memberNo, pointsSummary, ledgerFor, rewardsSettings, NIGERIAN_STATES } from '../_lib/rewards.js';
import { rewardsSweep } from '../_lib/rewardsEarn.js';
import { tierStatus, celebration } from '../_lib/rewardsTiers.js';
import { tierBenefits } from '../_lib/rewardsRules.js';

// GET /api/rewards/me -- the signed-in fan's Rewards status:
// { signedIn, verified, joined, memberNo, balance, pending, profile, history, bonuses }.
// Never errors for a guest (signedIn: false). `live`: the programme is launched
// (until then the site only shows Rewards in preview).
export async function onRequestGet({ request, env }) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const db = env.DB;
    await ensureRewardsSchema(db);
    const s = await rewardsSettings(db);
    const memberId = await readSession(request, env.SESSION_SECRET);
    if (!memberId) return Response.json({ signedIn: false, live: !!s.live, bonuses: { welcome: s.welcomeBonus, profile: s.profileBonus } }, { headers });
    await ensureFanSchema(db);
    const fan = await db.prepare(`SELECT id, first_name, email_verified, state, date_of_birth FROM members WHERE id = ?`).bind(memberId).first();
    if (!fan) return Response.json({ signedIn: false, live: !!s.live }, { headers });
    const base = {
      live: !!s.live, signedIn: true, firstName: fan.first_name, verified: !!fan.email_verified,
      profile: { state: fan.state || '', dateOfBirth: fan.date_of_birth || '' }, states: NIGERIAN_STATES,
      bonuses: { welcome: s.welcomeBonus, profile: s.profileBonus },
    };
    const r = await rewardsMember(db, memberId);
    if (!r) return Response.json({ ...base, joined: false }, { headers });
    // This fan's ticket points of played matches, prediction results and birthday bonus, straight away.
    await rewardsSweep(env, { memberId });
    const [sum, history, st] = await Promise.all([pointsSummary(db, memberId), ledgerFor(db, memberId, 50), tierStatus(db, memberId)]);
    const celebrate = await celebration(db, memberId, st);
    return Response.json({
      ...base, joined: true, memberNo: memberNo(r.seq), referralLink: `https://lobistarsfc.com/fans/register/?ref=${memberNo(r.seq)}`, status: r.status, joinedAt: r.joined_at,
      balance: sum.balance, pending: sum.pending, history,
      // Tier: from points earned this season (spending never lowers it). All numbers from the settings.
      tier: {
        key: st.tier.key, name: st.tier.name, season: st.season, earned: st.earned, reason: st.reason, graceUntil: st.graceUntil,
        benefits: st.benefits, next: st.next ? { key: st.next.key, name: st.next.name, min: st.next.min, benefits: st.nextBenefits } : null, toNext: st.toNext,
        all: st.tiers.map(t => ({ key: t.key, name: t.name, min: t.min, benefits: tierBenefits(t) })),
        celebrate, starWall: !!r.star_wall,
      },
      profileBonusDone: history.some(h => h.source === 'profile'),
    }, { headers });
  } catch (err) {
    console.error('[rewards] me', err);
    return Response.json({ error: 'Could not load your Rewards just now.' }, { status: 500, headers });
  }
}
