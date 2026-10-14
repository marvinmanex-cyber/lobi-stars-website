// Lobi Stars Rewards: earning Pride Points from SERVER-SIDE events only
// (confirmed Paystack payments, gate scans, saved votes and predictions).
// Every award is a ledger row with a unique (source, source_ref), so a
// repeated webhook or a double scan can never award twice. Every hook here is
// safe to call from payment code: it never throws (errors are logged), so
// Rewards can never break a payment, a ticket or the gate.
import { ensureRewardsSchema, rewardsSettings, addLedger } from './rewards.js';
import { purchaseMultiplier, checkTierUpgrade } from './rewardsTiers.js';
import { purchasePoints, lagosMonthStartUtc, capAllowance, streakReached, selfReferralReason, birthdayDue, lagosYear } from './rewardsRules.js';

const safe = (label, fn) => fn().catch(err => { console.error(`[rewards] ${label}`, err); return null; });
const ENGAGEMENT = ['vote', 'prediction', 'programme'];

/** The fan account for an email (any account; Rewards membership is checked when points are added). */
async function memberByEmail(db, email) {
  if (!email) return null;
  return db.prepare(`SELECT id FROM members WHERE lower(email) = lower(?)`).bind(String(email).trim()).first();
}

/**
 * Purchase points for an order (times the fan's tier multiplier, rounded down),
 * then a possible referral reward for whoever referred this fan, and the tier
 * upgrade email if they moved up.
 */
async function earnPurchase(db, { memberId, source, ref, paidKobo, per100, description, pending = false, eventId = null, payRef = null, env = null }) {
  await ensureRewardsSchema(db);
  if (!memberId) return false;
  const points = purchasePoints(paidKobo, per100, await purchaseMultiplier(db, memberId));
  let added = false;
  if (points > 0) added = await addLedger(db, { memberId, type: 'EARN', points, status: pending ? 'PENDING' : 'AVAILABLE', source, sourceRef: ref, description, eventId, payRef });
  // First paid purchase on lobistarsfc.com: a one-off bonus (once per fan; reversed with this payment if refunded).
  if (added) { const s = await rewardsSettings(db); if (s.firstPurchaseBonus > 0) await addLedger(db, { memberId, type: 'BONUS', points: s.firstPurchaseBonus, source: 'first_purchase', sourceRef: memberId, description: 'First purchase on lobistarsfc.com', payRef }); }
  const referrer = await maybeReferral(db, memberId);
  if (env) { if (added) await checkTierUpgrade(env, memberId); if (referrer) await checkTierUpgrade(env, referrer); }
  return added;
}

/** Match tickets (one orders row): pending until the match is played. */
export function earnTickets(env, order, event) {
  return safe('tickets', async () => {
    const db = env.DB;
    await ensureRewardsSchema(db);
    const s = await rewardsSettings(db);
    const m = await memberByEmail(db, order.buyer_email);
    if (!m) return false;
    const played = await matchPlayed(db, order.event_id);
    const payRef = String(order.paystack_reference || '').replace(/^(LSBAS-[A-Z0-9]+)-\d+$/, '$1');
    const vs = event ? `${event.home_team} vs ${event.away_team}` : 'a home match';
    return earnPurchase(db, { env, memberId: m.id, source: 'ticket_order', ref: order.id, paidKobo: order.total_kobo, per100: s.ticketsPer100,
      description: `Tickets: ${vs} (${order.quantity})`, pending: !played, eventId: order.event_id, payRef });
  });
}

/** Season ticket: one purchase for many matches, so its points are available straight away. */
export function earnSeasonTicket(env, row) {
  return safe('season ticket', async () => {
    const db = env.DB;
    const s = await rewardsSettings(db);
    const m = row.member_id ? { id: row.member_id } : await memberByEmail(db, row.buyer_email);
    if (!m) return false;
    return earnPurchase(db, { env, memberId: m.id, source: 'ticket_order', ref: `season:${row.id}`, paidKobo: row.total_kobo, per100: s.ticketsPer100, description: `Season ticket ${row.season || ''}`.trim(), payRef: row.paystack_reference });
  });
}

/** Shirts and merchandise bought through OUR checkout (not Jumia). */
export function earnShop(env, row) {
  return safe('shop', async () => {
    const db = env.DB;
    const s = await rewardsSettings(db);
    const m = await memberByEmail(db, row.buyer_email);
    if (!m) return false;
    return earnPurchase(db, { env, memberId: m.id, source: 'shop_order', ref: row.id, paidKobo: row.total_kobo, per100: s.shopPer100, description: `Shop order ${row.id}: ${row.product_name || 'shirt'}`, payRef: row.paystack_reference });
  });
}

/** In-seat food (MatchDay Kitchen), when the order becomes PAID. */
export function earnFood(env, order) {
  return safe('food', async () => {
    const db = env.DB;
    const s = await rewardsSettings(db);
    const m = await memberByEmail(db, order.email);
    if (!m) return false;
    return earnPurchase(db, { env, memberId: m.id, source: 'food_order', ref: order.id, paidKobo: order.total_kobo, per100: s.foodPer100, description: `MatchDay Kitchen order ${order.ref || order.id}`, payRef: order.paystack_reference });
  });
}

/** Annual membership paid online: purchase points plus the membership bonus. */
export function earnMembership(env, row) {
  return safe('membership', async () => {
    const db = env.DB;
    const s = await rewardsSettings(db);
    if (!row.member_id) return false;
    const added = await earnPurchase(db, { env, memberId: row.member_id, source: 'membership', ref: row.id, paidKobo: row.amount_kobo, per100: s.membershipPer100, description: `Membership ${row.season || ''}`.trim(), payRef: row.paystack_reference });
    if (s.membershipBonus > 0) await addLedger(db, { memberId: row.member_id, type: 'BONUS', points: s.membershipBonus, source: 'membership', sourceRef: `bonus:${row.id}`, description: 'Membership bonus', payRef: row.paystack_reference });
    await checkTierUpgrade(env, row.member_id); // paid members are at least Gold
    return added;
  });
}

/** Has this match been played (full-time)? */
async function matchPlayed(db, eventId) {
  const r = await db.prepare(`SELECT status FROM match_centre WHERE event_id = ?`).bind(eventId).first().catch(() => null);
  if (r?.status === 'full-time') return true;
  const f = await db.prepare(`SELECT status FROM league_fixtures WHERE event_id = ?`).bind(eventId).first().catch(() => null);
  return f?.status === 'full_time' || f?.status === 'awarded';
}

/**
 * Gate scan: attendance points (once per fan per match, however many of their
 * tickets are scanned) and the home-games-in-a-row bonus.
 */
export function earnAttendance(env, ticketId) {
  return safe('attendance', async () => {
    const db = env.DB;
    await ensureRewardsSchema(db);
    const s = await rewardsSettings(db);
    const t = await db.prepare(`SELECT t.event_id, o.buyer_email, e.home_team, e.away_team, e.event_date FROM tickets t JOIN orders o ON o.id = t.order_id JOIN events e ON e.id = t.event_id WHERE t.id = ?`).bind(ticketId).first();
    if (!t) return false;
    const m = await memberByEmail(db, t.buyer_email);
    if (!m || !(s.attendance > 0)) return false;
    const added = await addLedger(db, { memberId: m.id, type: 'EARN', points: s.attendance, source: 'attendance', sourceRef: `${m.id}:${t.event_id}`, description: `Attended ${t.home_team} vs ${t.away_team}`, eventId: t.event_id });
    if (added && s.streakBonus > 0) await streakBonus(db, m.id, t, s);
    if (added) await checkTierUpgrade(env, m.id);
    return added;
  });
}

async function streakBonus(db, memberId, t, s) {
  const { results: home } = await db.prepare(`SELECT e.id FROM events e LEFT JOIN match_centre mc ON mc.event_id = e.id
    WHERE (e.is_home = 1 OR (e.is_home IS NULL AND e.home_team LIKE 'Lobi Stars%')) AND e.active = 1 AND e.event_date <= ?
      AND COALESCE(mc.status, 'scheduled') NOT IN ('cancelled', 'postponed') ORDER BY e.event_date`).bind(t.event_date).all();
  const { results: mine } = await db.prepare(`SELECT source_ref, event_id FROM rewards_ledger WHERE member_id = ? AND source = 'attendance'`).bind(memberId).all();
  const attended = new Set(mine.filter(r => !r.source_ref.startsWith('streak:')).map(r => r.event_id));
  const bonusAt = new Set(mine.filter(r => r.source_ref.startsWith('streak:')).map(r => r.event_id));
  if (!streakReached(home.map(r => r.id), attended, bonusAt, s.streakLength)) return false;
  return addLedger(db, { memberId, type: 'BONUS', points: s.streakBonus, source: 'attendance', sourceRef: `streak:${memberId}:${t.event_id}`, description: `${s.streakLength} home matches in a row`, eventId: t.event_id });
}

/** Votes and predictions: capped per calendar month (Nigerian time). */
async function earnEngagement(db, { memberId, source, ref, points, description, eventId = null, env = null }) {
  await ensureRewardsSchema(db);
  const s = await rewardsSettings(db);
  if (!(points > 0)) return false;
  const used = await db.prepare(`SELECT COALESCE(SUM(points), 0) AS n FROM rewards_ledger WHERE member_id = ? AND source IN ('vote', 'prediction', 'programme') AND points > 0 AND created_at >= ?`)
    .bind(memberId, lagosMonthStartUtc()).first();
  const allowed = capAllowance(points, used?.n, s.engagementMonthlyCap);
  if (allowed <= 0) return false;
  const added = await addLedger(db, { memberId, type: 'EARN', points: allowed, source, sourceRef: ref, description: allowed < points ? `${description} (monthly limit reached)` : description, eventId });
  if (added && env) await checkTierUpgrade(env, memberId);
  return added;
}

export function earnVote(env, memberId, match) {
  return safe('vote', async () => {
    const s = await rewardsSettings(env.DB);
    return earnEngagement(env.DB, { env, memberId, source: 'vote', ref: `${match.id}:${memberId}`, points: s.motmVote, description: `Man of the Match vote: ${match.home_team} vs ${match.away_team}`, eventId: match.id });
  });
}

export function earnPrediction(env, memberId, match) {
  return safe('prediction', async () => {
    const s = await rewardsSettings(env.DB);
    return earnEngagement(env.DB, { env, memberId, source: 'prediction', ref: `submit:${match.id}:${memberId}`, points: s.prediction, description: `Predict & Win: ${match.home_team} vs ${match.away_team}`, eventId: match.id });
  });
}

/**
 * Referral: the referrer gets points once the friend (signed up with their
 * link) has a verified email and a first paid purchase. Self-referrals are
 * flagged, not paid; at most `referralMaxPerSeason` per referrer per season.
 */
async function maybeReferral(db, friendId) {
  const ref = await db.prepare(`SELECT * FROM rewards_referrals WHERE friend_member_id = ? AND status = 'waiting'`).bind(friendId).first();
  if (!ref) return false;
  const s = await rewardsSettings(db);
  const [friend, referrer] = await Promise.all([
    db.prepare(`SELECT id, email, last_name AS surname, phone_e164 AS phone, signup_device AS device, email_verified FROM members WHERE id = ?`).bind(friendId).first(),
    db.prepare(`SELECT id, email, last_name AS surname, phone_e164 AS phone, signup_device AS device FROM members WHERE id = ?`).bind(ref.referrer_member_id).first(),
  ]);
  if (!friend?.email_verified) return false;
  const decide = (status, reason = null) => db.prepare(`UPDATE rewards_referrals SET status = ?, reason = ?, decided_at = datetime('now') WHERE friend_member_id = ? AND status = 'waiting'`).bind(status, reason, friendId).run();
  const why = selfReferralReason(referrer, friend);
  if (why) { await decide('flagged', why); return false; }
  const season = await db.prepare(`SELECT COUNT(*) AS n FROM rewards_ledger WHERE member_id = ? AND source = 'referral' AND created_at >= ?`).bind(referrer.id, `${s.seasonStart || '1970-01-01'} 00:00:00`).first();
  if (s.referralMaxPerSeason > 0 && Number(season?.n) >= s.referralMaxPerSeason) { await decide('capped', 'season limit reached'); return false; }
  if (!(s.referral > 0)) return false;
  const added = await addLedger(db, { memberId: referrer.id, type: 'BONUS', points: s.referral, source: 'referral', sourceRef: friendId, description: 'A friend you referred made their first purchase' });
  await decide(added ? 'awarded' : 'flagged', added ? null : 'referrer is not an active, verified Rewards member');
  return added ? referrer.id : null;
}

/** Records who referred a new fan (at sign-up). `code` is the referrer's member number (LSR-000123). */
export async function recordReferral(db, friendId, code) {
  try {
    await ensureRewardsSchema(db);
    const seq = Number(String(code || '').toUpperCase().replace(/^LSR-/, ''));
    if (!Number.isInteger(seq) || seq < 1) return false;
    const r = await db.prepare(`SELECT member_id FROM rewards_members WHERE seq = ? AND status = 'active'`).bind(seq).first();
    if (!r || r.member_id === friendId) return false;
    await db.batch([
      db.prepare(`UPDATE members SET referred_by = ? WHERE id = ? AND referred_by IS NULL`).bind(r.member_id, friendId),
      db.prepare(`INSERT OR IGNORE INTO rewards_referrals (friend_member_id, referrer_member_id) VALUES (?, ?)`).bind(friendId, r.member_id),
    ]);
    return true;
  } catch (err) { console.error('[rewards] referral', err); return false; }
}

/**
 * Takes back the points of an order or payment (refund, cancelled match,
 * Paystack dispute). Pending points are simply cancelled (REVERSED); points
 * already available get a REVERSE row with minus points (the balance can go
 * below zero). Safe to repeat. `by`: { source, ref } or { payRef }.
 */
export function reversePoints(env, by, reason) {
  return safe('reverse', async () => {
    const db = env.DB;
    await ensureRewardsSchema(db);
    const { results } = by.payRef
      ? await db.prepare(`SELECT * FROM rewards_ledger WHERE pay_ref = ? AND type IN ('EARN', 'BONUS')`).bind(by.payRef).all()
      : await db.prepare(`SELECT * FROM rewards_ledger WHERE source = ? AND source_ref = ? AND type IN ('EARN', 'BONUS')`).bind(by.source, String(by.ref)).all();
    let n = 0;
    for (const row of results) {
      if (row.status === 'PENDING') {
        const r = await db.prepare(`UPDATE rewards_ledger SET status = 'REVERSED', description = description || ? WHERE id = ? AND status = 'PENDING'`).bind(` (cancelled: ${reason})`, row.id).run();
        n += r.meta.changes;
      } else if (row.status === 'AVAILABLE') {
        if (await addLedger(db, { memberId: row.member_id, type: 'REVERSE', points: -row.points, source: row.source, sourceRef: `reverse:${row.id}`, description: `Points removed: ${row.description} (${reason})`, eventId: row.event_id, payRef: row.pay_ref })) n++;
      }
    }
    return n;
  });
}

/** Ticket points become available once their match has been played. */
async function releaseTicketPoints(db, memberId = null) {
  const where = memberId ? 'AND member_id = ?' : '';
  const stmt = db.prepare(`UPDATE rewards_ledger SET status = 'AVAILABLE', available_at = ? WHERE status = 'PENDING' AND source = 'ticket_order' ${where}
    AND event_id IN (SELECT event_id FROM match_centre WHERE status = 'full-time' UNION SELECT event_id FROM league_fixtures WHERE status IN ('full_time', 'awarded') AND event_id IS NOT NULL)`);
  const r = await (memberId ? stmt.bind(new Date().toISOString(), memberId) : stmt.bind(new Date().toISOString())).run();
  return r.meta.changes;
}

/** Predict & Win results at full-time: exact score, otherwise correct result (monthly cap applies). */
async function settlePredictions(db, memberId = null) {
  const s = await rewardsSettings(db);
  const { results } = await db.prepare(`SELECT p.event_id, p.member_id, p.home_goals, p.away_goals, mc.home_score, mc.away_score, e.home_team, e.away_team
    FROM predictions p JOIN match_centre mc ON mc.event_id = p.event_id JOIN events e ON e.id = p.event_id JOIN rewards_members r ON r.member_id = p.member_id
    WHERE mc.status = 'full-time' AND mc.home_score IS NOT NULL AND mc.away_score IS NOT NULL ${memberId ? 'AND p.member_id = ?' : ''}
      AND NOT EXISTS (SELECT 1 FROM rewards_ledger l WHERE l.source = 'prediction' AND l.source_ref = 'result:' || p.event_id || ':' || p.member_id)
    LIMIT 500`).bind(...(memberId ? [memberId] : [])).all().catch(() => ({ results: [] }));
  let n = 0;
  const sign = x => Math.sign(x);
  for (const p of results) {
    const exact = p.home_goals === p.home_score && p.away_goals === p.away_score;
    const correct = sign(p.home_goals - p.away_goals) === sign(p.home_score - p.away_score);
    const points = exact ? s.predictionExact : correct ? s.predictionCorrect : 0;
    const vs = `${p.home_team} vs ${p.away_team}`;
    if (points > 0) { if (await earnEngagement(db, { memberId: p.member_id, source: 'prediction', ref: `result:${p.event_id}:${p.member_id}`, points, description: `${exact ? 'Exact score' : 'Correct result'}: ${vs}`, eventId: p.event_id })) n++; }
  }
  return n;
}

/** Birthday month bonus (once a year; date of birth saved 30+ days before). */
async function birthdays(db, memberId = null) {
  const s = await rewardsSettings(db);
  if (!(s.birthday > 0)) return 0;
  const month = String(new Date(Date.now() + 3600e3).getUTCMonth() + 1).padStart(2, '0');
  const { results } = await db.prepare(`SELECT m.id, m.date_of_birth, m.dob_set_at FROM members m JOIN rewards_members r ON r.member_id = m.id
    WHERE r.status = 'active' AND m.email_verified = 1 AND substr(m.date_of_birth, 6, 2) = ? ${memberId ? 'AND m.id = ?' : ''} LIMIT 1000`).bind(month, ...(memberId ? [memberId] : [])).all();
  let n = 0;
  for (const m of results) {
    if (birthdayDue(m.date_of_birth, m.dob_set_at, s.birthdayDobMinDays)) {
      if (await addLedger(db, { memberId: m.id, type: 'BONUS', points: s.birthday, source: 'birthday', sourceRef: `${m.id}:${lagosYear()}`, description: 'Happy birthday from Lobi Stars!' })) n++;
    }
  }
  return n;
}

/**
 * The regular Rewards job: ticket points of played matches become available,
 * prediction results and birthday bonuses are added. Runs from the cron
 * Worker (/api/internal/rewards-run) and, for one fan, when they open their points.
 */
export async function rewardsSweep(env, { memberId = null } = {}) {
  const db = env.DB;
  await ensureRewardsSchema(db);
  const out = { released: 0, predictions: 0, birthdays: 0 };
  out.released = (await safe('release', () => releaseTicketPoints(db, memberId))) || 0;
  out.predictions = (await safe('predictions', () => settlePredictions(db, memberId))) || 0;
  out.birthdays = (await safe('birthdays', () => birthdays(db, memberId))) || 0;
  if (memberId) await checkTierUpgrade(env, memberId);
  else {
    const { redemptionSweep } = await import('./rewardsCatalogue.js');
    Object.assign(out, (await safe('redemptions', () => redemptionSweep(env))) || {});
  }
  return out;
}

/** Admin: add or remove points by hand (reason required; also in the audit log). */
export async function adjustPoints(db, { memberId, points, reason, staff }) {
  await ensureRewardsSchema(db);
  const ref = `adj:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  return addLedger(db, { memberId, type: 'ADJUST', points, source: 'admin', sourceRef: ref, description: `Adjustment by the club: ${reason}`, createdBy: staff });
}

/** One-off bonus for an action that helps the club (once per fan). */
async function once(env, memberId, source, points, description) {
  const db = env.DB;
  await ensureRewardsSchema(db);
  if (!memberId || !(points > 0)) return false;
  const added = await addLedger(db, { memberId, type: 'BONUS', points, source, sourceRef: memberId, description });
  if (added) await checkTierUpgrade(env, memberId);
  return added;
}

/** Newsletter sign-up: the fan account with that email (once). */
export function earnNewsletter(env, email) {
  return safe('newsletter', async () => {
    const m = await memberByEmail(env.DB, email);
    return m ? once(env, m.id, 'newsletter', (await rewardsSettings(env.DB)).newsletterBonus, 'Signed up to the Lobi Stars newsletter') : false;
  });
}

/** Match alerts (push notifications) switched on by a signed-in fan (once). */
export function earnAlerts(env, memberId) {
  return safe('alerts', async () => once(env, memberId, 'alerts', (await rewardsSettings(env.DB)).alertsBonus, 'Switched on match alerts'));
}

/** Opening the Match Day Programme (signed in): per programme, monthly limit applies. */
export function earnProgramme(env, memberId, programme) {
  return safe('programme', async () => {
    const s = await rewardsSettings(env.DB);
    return earnEngagement(env.DB, { env, memberId, source: 'programme', ref: `${programme.id}:${memberId}`, points: s.programmeRead, description: `Read the Match Day Programme${programme.title ? `: ${programme.title}` : ''}` });
  });
}

export { ENGAGEMENT };
