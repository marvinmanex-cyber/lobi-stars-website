// Lobi Stars Rewards tiers (Red, Gold, Star): by Star Points EARNED in the
// current season (spending never lowers a tier), Gold for paid annual members,
// last season's tier kept for a grace period. Gives the purchase multiplier,
// early ticket access (presale) and the "You've reached Gold!" email.
// All numbers come from the Rewards settings (Admin › Rewards).
import { ensureRewardsSchema, rewardsSettings } from './rewards.js';
import { effectiveTier, tierRank, seasonLabel, tierBenefits } from './rewardsRules.js';
import { notify } from './rewardsNotify.js';

const sqlDate = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const seasonStartMs = s => Date.parse(`${s.seasonStart}T00:00:00+01:00`);

/** Points earned (available earnings minus reversals) between two times. */
async function earnedBetween(db, memberId, fromMs, toMs) {
  const r = await db.prepare(`SELECT COALESCE(SUM(points), 0) AS n FROM rewards_ledger
    WHERE member_id = ? AND type IN ('EARN', 'BONUS', 'REVERSE') AND source NOT IN ('redeem', 'points_payment') AND status = 'AVAILABLE' AND created_at >= ? AND created_at < ?`)
    .bind(memberId, sqlDate(fromMs), sqlDate(toMs)).first();
  return Math.max(0, Number(r?.n) || 0);
}

/** The fan's tier now: { tier, next, toNext, earned, reason, graceUntil, benefits, nextBenefits, season, tiers }. */
export async function tierStatus(db, memberId, now = Date.now()) {
  await ensureRewardsSchema(db);
  const s = await rewardsSettings(db);
  const start = seasonStartMs(s);
  const prevStart = new Date(start); prevStart.setUTCFullYear(prevStart.getUTCFullYear() - 1);
  const season = seasonLabel(s.seasonStart);
  const [earned, prevEarned, m] = await Promise.all([
    earnedBetween(db, memberId, start, now + 864e5),
    earnedBetween(db, memberId, prevStart.getTime(), start),
    db.prepare(`SELECT membership_season FROM members WHERE id = ?`).bind(memberId).first().catch(() => null),
  ]);
  const t = effectiveTier({ earned, prevEarned, paidMember: !!season && m?.membership_season === season, now, seasonStart: s.seasonStart, graceMonths: s.tierGraceMonths, paidMembersStartGold: s.paidMembersStartGold }, s.tiers);
  return { ...t, earned, season, tiers: s.tiers, benefits: tierBenefits(t.tier), nextBenefits: t.next ? tierBenefits(t.next) : [] };
}

/** Purchase multiplier for this fan (1 when Rewards isn't live or they aren't an active member). */
export async function purchaseMultiplier(db, memberId) {
  try {
    const s = await rewardsSettings(db);
    if (!s.live) return 1;
    return (await tierStatus(db, memberId)).tier.multiplier || 1;
  } catch { return 1; }
}

/**
 * Early ticket access for a signed-in fan, in milliseconds (0 = none). Only
 * active, verified Rewards members, and only once Rewards is live.
 */
export async function presaleMs(db, memberId) {
  try {
    if (!memberId) return 0;
    const s = await rewardsSettings(db);
    if (!s.live) return 0;
    const ok = await db.prepare(`SELECT 1 FROM rewards_members r JOIN members m ON m.id = r.member_id WHERE r.member_id = ? AND r.status = 'active' AND m.email_verified = 1`).bind(memberId).first();
    if (!ok) return 0;
    return ((await tierStatus(db, memberId)).tier.presaleHours || 0) * 3600e3;
  } catch { return 0; }
}

/** Sends "You've reached Gold!" once per tier per season when a fan moves up. Never throws. */
export async function checkTierUpgrade(env, memberId) {
  try {
    const db = env.DB;
    const st = await tierStatus(db, memberId);
    const row = await db.prepare(`SELECT r.tier_notified, r.status, m.first_name, m.email, m.email_verified FROM rewards_members r JOIN members m ON m.id = r.member_id WHERE r.member_id = ?`).bind(memberId).first();
    if (!row || row.status !== 'active' || !row.email_verified) return false;
    const [nSeason, nKey] = String(row.tier_notified || '').split(':');
    const before = nSeason === st.season ? tierRank(nKey, st.tiers) : 0;
    const now = tierRank(st.tier.key, st.tiers);
    if (now <= before) return false;
    const claim = await db.prepare(`UPDATE rewards_members SET tier_notified = ? WHERE member_id = ? AND (tier_notified IS ? )`).bind(`${st.season}:${st.tier.key}`, memberId, row.tier_notified).run();
    if (!claim.meta.changes) return true;
    const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    await notify(env, memberId, { kind: 'tier', ref: `${st.season}:${st.tier.key}`, title: `You've reached ${st.tier.name}!`,
      body: `Your support this season has taken you to ${st.tier.name} in Lobi Stars Rewards. ${st.benefits.join(' · ')}`,
      email: { subject: `You've reached ${st.tier.name}! – Lobi Stars Rewards`,
        html: `<p>Well done! Your support this season has taken you to <strong>${esc(st.tier.name)}</strong> in Lobi Stars Rewards.</p><ul>${st.benefits.map(b => `<li>${esc(b)}</li>`).join('')}</ul><p style="font-size:12px;color:#888;">Lobi Stars Rewards Terms: lobistarsfc.com/rewards/terms</p>` } });
    return true;
  } catch (err) { console.error('[rewards] tier check', err); return false; }
}

/** The on-screen celebration: true once per new tier per season; `seen` marks it shown. */
export async function celebration(db, memberId, st, { seen = false } = {}) {
  const row = await db.prepare(`SELECT tier_seen FROM rewards_members WHERE member_id = ?`).bind(memberId).first();
  const [sSeason, sKey] = String(row?.tier_seen || '').split(':');
  const before = sSeason === st.season ? tierRank(sKey, st.tiers) : 0;
  const up = tierRank(st.tier.key, st.tiers) > before;
  if (up && seen) await db.prepare(`UPDATE rewards_members SET tier_seen = ? WHERE member_id = ?`).bind(`${st.season}:${st.tier.key}`, memberId).run();
  return up;
}

/**
 * Every Rewards member at once (for exports and reports): Map member_id ->
 * { status, tier, tierKey, earned, balance }. A fixed number of queries, however
 * many members there are.
 */
export async function rewardsTierMap(db, now = Date.now()) {
  await ensureRewardsSchema(db);
  const s = await rewardsSettings(db);
  const start = seasonStartMs(s);
  const prevStart = new Date(start); prevStart.setUTCFullYear(prevStart.getUTCFullYear() - 1);
  const season = seasonLabel(s.seasonStart);
  const earnedSql = `SELECT member_id, COALESCE(SUM(points), 0) AS n FROM rewards_ledger
    WHERE type IN ('EARN', 'BONUS', 'REVERSE') AND source NOT IN ('redeem', 'points_payment') AND status = 'AVAILABLE' AND created_at >= ? AND created_at < ? GROUP BY member_id`;
  const hasSeason = (await db.prepare(`PRAGMA table_info(members)`).all()).results.some(c => c.name === 'membership_season');
  const [mem, cur, prev, bal] = await Promise.all([
    db.prepare(`SELECT r.member_id, r.status${hasSeason ? ', m.membership_season' : ''} FROM rewards_members r JOIN members m ON m.id = r.member_id`).all(),
    db.prepare(earnedSql).bind(sqlDate(start), sqlDate(now + 864e5)).all(),
    db.prepare(earnedSql).bind(sqlDate(prevStart.getTime()), sqlDate(start)).all(),
    db.prepare(`SELECT member_id, COALESCE(SUM(points), 0) AS n FROM rewards_ledger WHERE status = 'AVAILABLE' GROUP BY member_id`).all(),
  ]);
  const toMap = r => new Map(r.results.map(x => [x.member_id, Math.max(0, Number(x.n) || 0)]));
  const curM = toMap(cur), prevM = toMap(prev), balM = new Map(bal.results.map(x => [x.member_id, Number(x.n) || 0]));
  const out = new Map();
  for (const m of mem.results) {
    const earned = curM.get(m.member_id) || 0;
    const t = effectiveTier({ earned, prevEarned: prevM.get(m.member_id) || 0, paidMember: !!season && m.membership_season === season, now, seasonStart: s.seasonStart, graceMonths: s.tierGraceMonths, paidMembersStartGold: s.paidMembersStartGold }, s.tiers);
    out.set(m.member_id, { status: m.status, tier: t.tier.name, tierKey: t.tier.key, earned, balance: balM.get(m.member_id) || 0 });
  }
  return out;
}
