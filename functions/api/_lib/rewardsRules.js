// Lobi Stars Rewards: pure earning rules (no database), unit-tested in
// tests/rewards-rules.unit.test.mjs. Every number comes from the Rewards
// settings (Admin › Rewards); nothing is hard-coded here.

/** Purchase points: `per100` points per ₦100 actually paid, rounded down. kobo -> points. */
export function purchasePoints(paidKobo, per100, multiplier = 1) {
  const k = Math.max(0, Math.floor(Number(paidKobo) || 0));
  const base = Math.floor((k * (Number(per100) || 0)) / 10000);
  return Math.floor(base * (Number(multiplier) || 1));
}

/** Start of the current calendar month in Nigeria (UTC+1), as "YYYY-MM-DD HH:MM:SS" UTC (the ledger's created_at format). */
export function lagosMonthStartUtc(now = Date.now()) {
  const lagos = new Date(now + 3600e3);
  const start = Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), 1) - 3600e3;
  return new Date(start).toISOString().replace('T', ' ').slice(0, 19);
}

/** Engagement points allowed now, given what was already earned this month and the monthly cap (0 = no cap). */
export function capAllowance(points, usedThisMonth, cap) {
  if (!(cap > 0)) return points;
  return Math.max(0, Math.min(points, cap - (Number(usedThisMonth) || 0)));
}

/**
 * Home-match streak: `attended` is a Set of event ids the fan attended;
 * `homeMatches` the home matches up to and including this one, oldest first;
 * `bonusAt` the event ids where a streak bonus was already given.
 * True when the last `length` home matches were all attended and none of them
 * already counted towards a previous streak bonus.
 */
export function streakReached(homeMatches, attended, bonusAt, length) {
  if (!(length >= 2) || homeMatches.length < length) return false;
  const last = homeMatches.slice(-length);
  if (!last.every(id => attended.has(id))) return false;
  return !last.slice(0, -1).some(id => bonusAt.has(id));
}

const FREE_MAIL = new Set(['gmail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'aol.com', 'ymail.com', 'mail.com', 'proton.me', 'protonmail.com']);

/**
 * Why a referral looks like a self-referral (or null when it looks fine):
 * same phone, same device, or the same surname at the same private email domain.
 */
export function selfReferralReason(referrer, friend) {
  if (!referrer || !friend) return 'missing account';
  if (referrer.id === friend.id) return 'same account';
  if (referrer.phone && friend.phone && referrer.phone === friend.phone) return 'same phone';
  if (referrer.device && friend.device && referrer.device === friend.device) return 'same device';
  const dom = e => String(e || '').toLowerCase().split('@')[1] || '';
  const sur = s => String(s || '').trim().toLowerCase();
  const d = dom(friend.email);
  if (d && d === dom(referrer.email) && !FREE_MAIL.has(d) && sur(friend.surname) && sur(friend.surname) === sur(referrer.surname)) return 'same surname and email domain';
  // Near-identical email names (e.g. terna.akaa1@ and terna.akaa2@).
  const local = e => String(e || '').toLowerCase().split('@')[0].replace(/[^a-z]/g, '');
  if (d && d === dom(referrer.email) && local(friend.email).length >= 4 && local(friend.email) === local(referrer.email)) return 'same email name pattern';
  return null;
}

/**
 * Birthday bonus due? `dob` "YYYY-MM-DD", `dobSetAt` ISO when the date of
 * birth was saved. Due in the birthday month (Nigerian time) when the date of
 * birth was saved at least `minDays` days before.
 */
export function birthdayDue(dob, dobSetAt, minDays, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || '') || !dobSetAt) return false;
  const lagos = new Date(now + 3600e3);
  if (Number(dob.slice(5, 7)) !== lagos.getUTCMonth() + 1) return false;
  return now - Date.parse(dobSetAt) >= (Number(minDays) || 0) * 864e5;
}

/** Year of the birthday bonus (one per year), Nigerian time. */
export const lagosYear = (now = Date.now()) => new Date(now + 3600e3).getUTCFullYear();

/** Settings validation for Admin › Rewards. Returns null or the problem. */
export function settingsProblem(s) {
  const ints = ['welcomeBonus', 'profileBonus', 'membershipBonus', 'attendance', 'streakBonus', 'streakLength', 'motmVote', 'prediction', 'predictionCorrect', 'predictionExact', 'referral', 'referralMaxPerSeason', 'birthday', 'birthdayDobMinDays', 'engagementMonthlyCap', 'newsletterBonus', 'alertsBonus', 'firstPurchaseBonus', 'programmeRead', 'exampleJerseyNaira', 'exampleTicketNaira', 'exampleFoodNaira'];
  for (const k of ints) if (!Number.isInteger(s[k]) || s[k] < 0 || s[k] > 100000) return `${k}: a whole number from 0 to 100,000.`;
  for (const k of ['ticketsPer100', 'shopPer100', 'foodPer100', 'membershipPer100']) if (typeof s[k] !== 'number' || !(s[k] >= 0) || s[k] > 100) return `${k}: 0 to 100 points per ₦100.`;
  if (s.streakLength < 2 || s.streakLength > 20) return 'Home games in a row: 2 to 20.';
  if (s.birthdayDobMinDays > 365) return 'Birthday: date of birth saved at least 0 to 365 days before.';
  if (!Number.isInteger(s.pointValueKobo) || s.pointValueKobo < 1 || s.pointValueKobo > 100000) return 'Value of 1 point: from 1 kobo.';
  if (!Number.isInteger(s.payWithPointsMaxPercent) || s.payWithPointsMaxPercent < 0 || s.payWithPointsMaxPercent > 100) return 'Pay with points: 0 to 100% of an order.';
  if (!Number.isInteger(s.payWithPointsMin) || s.payWithPointsMin < 1) return 'Pay with points: at least 1 point.';
  if (!Number.isInteger(s.expiryMonths) || s.expiryMonths < 1 || s.expiryMonths > 60) return 'Points expire after: 1 to 60 months.';
  if (!Number.isInteger(s.tierGraceMonths) || s.tierGraceMonths < 0 || s.tierGraceMonths > 12) return 'Tier grace period: 0 to 12 months.';
  if (!Number.isInteger(s.redeemCodeThreshold) || s.redeemCodeThreshold < 1) return 'Email code needed from: at least 1 point.';
  if (!Number.isInteger(s.voucherDays) || s.voucherDays < 1 || s.voucherDays > 730) return 'Vouchers valid: 1 to 730 days.';
  if (!Number.isInteger(s.vtuMaxAttempts) || s.vtuMaxAttempts < 1 || s.vtuMaxAttempts > 10) return 'Airtime/data tries: 1 to 10.';
  if (s.tiers !== undefined) { const t = tiersProblem(s.tiers); if (t) return t; }
  return null;
}

// ── Tiers ──
// tiers: [{ key, name, min, multiplier, presaleHours, benefits: [text] }], lowest first (min 0).

/** The tier for points earned this season. */
export function tierFor(points, tiers) {
  const list = [...tiers].sort((a, b) => a.min - b.min);
  let t = list[0];
  for (const x of list) if ((Number(points) || 0) >= x.min) t = x;
  return t;
}
export const tierRank = (key, tiers) => [...tiers].sort((a, b) => a.min - b.min).findIndex(t => t.key === key);

/** "2026/27" for a season starting in 2026 (same format as membership seasons). */
export function seasonLabel(seasonStart) {
  const y = Number(String(seasonStart || '').slice(0, 4));
  return y ? `${y}/${String((y + 1) % 100).padStart(2, '0')}` : '';
}

/** Adds `months` calendar months to a "YYYY-MM-DD" date; returns ms. */
export function addMonths(dateStr, months) {
  // Calendar months in Nigerian time: midnight (UTC+1) on the same day `months` later.
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return Date.UTC(y, m - 1 + (Number(months) || 0), d) - 3600e3;
}

/**
 * The fan's tier: the highest of (1) points earned this season, (2) Gold for a
 * paid annual member this season (when switched on), (3) last season's tier
 * during the grace period after the season starts. Spending points never
 * lowers it. Returns { tier, next, toNext, reason, graceUntil }.
 */
export function effectiveTier({ earned, prevEarned = 0, paidMember = false, now = Date.now(), seasonStart, graceMonths = 0, paidMembersStartGold = true }, tiers) {
  const list = [...tiers].sort((a, b) => a.min - b.min);
  let tier = tierFor(earned, list), reason = 'points';
  const better = (t, why) => { if (tierRank(t.key, list) > tierRank(tier.key, list)) { tier = t; reason = why; } };
  if (paidMember && paidMembersStartGold) { const gold = list.find(t => t.key === 'gold'); if (gold) better(gold, 'member'); }
  const graceUntil = seasonStart && graceMonths > 0 ? addMonths(seasonStart, graceMonths) : null;
  if (graceUntil && now < graceUntil) better(tierFor(prevEarned, list), 'last-season');
  const i = tierRank(tier.key, list);
  // Next tier by points (what the fan sees on the progress bar).
  const next = list.slice(i + 1).find(t => t.min > (Number(earned) || 0)) || null;
  return { tier, next, toNext: next ? next.min - (Number(earned) || 0) : 0, reason, graceUntil: reason === 'last-season' ? new Date(graceUntil).toISOString() : null };
}

/** Checks the tier settings: three tiers, Red from 0, rising thresholds, sane multipliers and presale hours. */
export function tiersProblem(tiers) {
  if (!Array.isArray(tiers) || tiers.length !== 3) return 'There are three tiers: Red, Gold and Legend.';
  const [r, g, s] = tiers;
  if (r.key !== 'red' || g.key !== 'gold' || s.key !== 'legend') return 'Tiers must be Red, Gold, Legend.';
  if (r.min !== 0) return 'Red starts at 0 points.';
  if (!(Number.isInteger(g.min) && g.min > 0 && Number.isInteger(s.min) && s.min > g.min && s.min <= 1_000_000)) return 'Gold needs more points than Red, and Legend more than Gold.';
  for (const t of tiers) {
    if (typeof t.multiplier !== 'number' || t.multiplier < 1 || t.multiplier > 5) return `${t.name}: purchase multiplier from 1 to 5.`;
    if (!Number.isInteger(t.presaleHours) || t.presaleHours < 0 || t.presaleHours > 168) return `${t.name}: early ticket access 0 to 168 hours.`;
    if (!Array.isArray(t.benefits) || t.benefits.length > 12 || t.benefits.some(b => typeof b !== 'string' || b.length > 140)) return `${t.name}: up to 12 benefits of 140 characters.`;
  }
  return null;
}

/** A tier's benefits in plain English, written from its settings (never hard-coded). */
export function tierBenefits(t) {
  const out = [];
  if (t.multiplier > 1) out.push(`${t.multiplier}x Star Points on purchases`);
  if (t.presaleHours > 0) out.push(`Buy match tickets ${t.presaleHours} hours before general sale`);
  return out.concat(t.benefits || []);
}
