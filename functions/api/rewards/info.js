import { ensureRewardsSchema, rewardsSettings } from '../_lib/rewards.js';
import { tierBenefits } from '../_lib/rewardsRules.js';
import { listItems, ensureCatalogueSchema } from '../_lib/rewardsCatalogue.js';

// GET /api/rewards/info -- everything the public "How Lobi Stars Rewards
// works" page shows, read live from the Rewards settings and catalogue
// (earn rates, bonuses, limits, tiers, expiry, rewards). No personal data.
export async function onRequestGet({ env }) {
  const headers = { 'Cache-Control': 'public, max-age=120' };
  try {
    const db = env.DB;
    await ensureRewardsSchema(db);
    await ensureCatalogueSchema(db);
    const s = await rewardsSettings(db);
    const items = (await listItems(db)).map(i => ({ id: i.id, name: i.name, description: i.description, image: i.image, type: i.type, group: i.group, points: i.points, sponsor: i.sponsor, available: i.stock === null || i.stock > 0 }));
    const keys = ['welcomeBonus', 'profileBonus', 'ticketsPer100', 'shopPer100', 'foodPer100', 'membershipPer100', 'membershipBonus', 'attendance', 'streakBonus', 'streakLength',
      'motmVote', 'prediction', 'predictionCorrect', 'predictionExact', 'referral', 'referralMaxPerSeason', 'birthday', 'engagementMonthlyCap', 'newsletterBonus', 'alertsBonus',
      'firstPurchaseBonus', 'programmeRead', 'expiryMonths', 'voucherDays', 'redeemCodeThreshold', 'tierGraceMonths', 'paidMembersStartGold', 'exampleJerseyNaira', 'exampleTicketNaira', 'exampleFoodNaira'];
    return Response.json({
      live: !!s.live, settings: Object.fromEntries(keys.map(k => [k, s[k]])),
      tiers: s.tiers.map(t => ({ key: t.key, name: t.name, min: t.min, multiplier: t.multiplier, presaleHours: t.presaleHours, benefits: tierBenefits(t) })),
      items,
    }, { headers });
  } catch (err) {
    console.error('[rewards] info', err);
    return Response.json({ error: 'Could not load.' }, { status: 500 });
  }
}
