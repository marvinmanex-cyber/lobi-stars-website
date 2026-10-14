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
  const ints = ['welcomeBonus', 'profileBonus', 'membershipBonus', 'attendance', 'streakBonus', 'streakLength', 'motmVote', 'prediction', 'predictionCorrect', 'predictionExact', 'referral', 'referralMaxPerSeason', 'birthday', 'birthdayDobMinDays', 'engagementMonthlyCap'];
  for (const k of ints) if (!Number.isInteger(s[k]) || s[k] < 0 || s[k] > 100000) return `${k}: a whole number from 0 to 100,000.`;
  for (const k of ['ticketsPer100', 'shopPer100', 'foodPer100', 'membershipPer100']) if (typeof s[k] !== 'number' || !(s[k] >= 0) || s[k] > 100) return `${k}: 0 to 100 points per ₦100.`;
  if (s.streakLength < 2 || s.streakLength > 20) return 'Home games in a row: 2 to 20.';
  if (s.birthdayDobMinDays > 365) return 'Birthday: date of birth saved at least 0 to 365 days before.';
  return null;
}
