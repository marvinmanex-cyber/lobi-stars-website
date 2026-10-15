// Lobi Stars Rewards at OUR checkouts (match tickets, MatchDay Kitchen food,
// personalised shirts): "Use my Star Points" and reward vouchers.
//   - Pay with points: pointValueKobo per point, at least payWithPointsMin
//     points, at most payWithPointsMaxPercent of the order. The points are
//     HELD (a PENDING minus row) when payment starts, TAKEN when Paystack
//     confirms, and RELEASED if the payment fails or is abandoned.
//   - Vouchers: a fan's issued voucher that fits this checkout is RESERVED
//     when payment starts, marked USED when it is paid, and freed otherwise.
//   - No points are earned on the part paid with points (the order total
//     after points is what earns), and a refund gives the points back.
// Only for signed-in, verified, active Rewards members, once Rewards is live.
// Points have no cash value: they only ever reduce an order.
import { ensureRewardsSchema, rewardsSettings, rewardsMember } from './rewards.js';
import { ensureCatalogueSchema, spendable } from './rewardsCatalogue.js';

/** Which issued vouchers fit a checkout. kind: 'tickets' | 'food' | 'shop'; ctx.feeKobo = personalisation fee. */
function voucherValue(v, kind, subtotalKobo, ctx = {}) {
  const cfg = v.config || {};
  if (kind === 'food' && cfg.kind === 'food') return Math.min(subtotalKobo, Number(v.value_kobo) || 0);
  if (kind === 'shop' && cfg.kind === 'shop') {
    if (cfg.appliesTo === 'personalisation') return Math.min(subtotalKobo, Number(ctx.feeKobo) || 0);
    if (!cfg.appliesTo || cfg.appliesTo === 'jersey' || cfg.appliesTo === 'any') return Math.min(subtotalKobo, Number(v.value_kobo) || 0);
  }
  return 0;
}

async function memberVouchers(db, memberId) {
  const { results } = await db.prepare(`SELECT r.*, c.config_json FROM rewards_redemptions r LEFT JOIN rewards_catalogue c ON c.id = r.item_id
    WHERE r.member_id = ? AND r.type = 'voucher' AND r.status = 'issued' AND (r.expires_at IS NULL OR r.expires_at > ?) ORDER BY r.expires_at`).bind(memberId, new Date().toISOString()).all();
  return results.map(r => { let config = {}; try { config = JSON.parse(r.config_json || '{}'); } catch { /* none */ } return { ...r, config }; });
}

/** What this fan can use at this checkout (for the "Use my Star Points" box). */
export async function checkoutOptions(env, memberId, kind, subtotalKobo, ctx = {}) {
  const db = env.DB;
  await ensureRewardsSchema(db);
  await ensureCatalogueSchema(db);
  const s = await rewardsSettings(db);
  const m = memberId ? await rewardsMember(db, memberId) : null;
  if (!s.live || !m || m.status !== 'active' || !m.email_verified) return { available: false, live: !!s.live, member: !!m };
  const balance = await spendable(db, memberId);
  const vouchers = (await memberVouchers(db, memberId)).map(v => ({ code: v.voucher_code, name: v.item_name, valueKobo: voucherValue(v, kind, subtotalKobo, ctx), expiresAt: v.expires_at })).filter(v => v.valueKobo > 0);
  const maxKobo = Math.floor(subtotalKobo * s.payWithPointsMaxPercent / 100);
  const maxPoints = Math.max(0, Math.min(balance, Math.floor(maxKobo / s.pointValueKobo)));
  return { available: true, balance, pointValueKobo: s.pointValueKobo, minPoints: s.payWithPointsMin, maxPercent: s.payWithPointsMaxPercent, maxPoints: maxPoints >= s.payWithPointsMin ? maxPoints : 0, vouchers };
}

/**
 * Checks the fan's choice (points and/or voucher) for an order of
 * `subtotalKobo` and holds it against `reference` (the Paystack reference).
 * Returns { pointsUsed, pointsKobo, voucherCode, voucherKobo, totalKobo } or { error }.
 * Nothing is held when there is nothing to use.
 */
export async function holdCheckoutRewards(env, { memberId, kind, subtotalKobo, usePoints, voucherCode, reference, ctx = {} }) {
  const none = { pointsUsed: 0, pointsKobo: 0, voucherCode: null, voucherKobo: 0, totalKobo: subtotalKobo };
  const pts = Math.max(0, Math.floor(Number(usePoints) || 0));
  const code = String(voucherCode || '').trim().toUpperCase();
  if (!pts && !code) return none;
  const db = env.DB;
  const opt = await checkoutOptions(env, memberId, kind, subtotalKobo, ctx);
  if (!opt.available) return { error: 'Log in with your Lobi Stars Rewards account to use Star Points or a voucher.' };
  let voucherKobo = 0, voucher = null;
  if (code) {
    voucher = opt.vouchers.find(v => v.code === code);
    if (!voucher) return { error: 'That voucher can\'t be used for this order (or it has been used or has expired).' };
    // Paystack can't take ₦0: a voucher leaves at least ₦100 to pay.
    voucherKobo = Math.max(0, Math.min(voucher.valueKobo, subtotalKobo - 10000));
  }
  const afterVoucher = subtotalKobo - voucherKobo;
  let pointsKobo = 0;
  if (pts) {
    const s = await rewardsSettings(db);
    if (pts < s.payWithPointsMin) return { error: `Use at least ${s.payWithPointsMin.toLocaleString('en-NG')} Star Points.` };
    pointsKobo = pts * s.pointValueKobo;
    if (pointsKobo > Math.floor(afterVoucher * s.payWithPointsMaxPercent / 100)) return { error: `Star Points can pay up to ${s.payWithPointsMaxPercent}% of an order.` };
  }
  // Reserve the voucher, then hold the points (each guarded; undone if the other fails).
  if (voucher) {
    const r = await db.prepare(`UPDATE rewards_redemptions SET status = 'reserved', provider_ref = ?, updated_at = datetime('now') WHERE voucher_code = ? AND member_id = ? AND status = 'issued'`).bind(reference, code, memberId).run();
    if (!r.meta.changes) return { error: 'That voucher has just been used.' };
  }
  if (pts) {
    const r = await db.prepare(`INSERT INTO rewards_ledger (member_id, type, points, status, source, source_ref, description, pay_ref)
      SELECT ?, 'REDEEM', ?, 'PENDING', 'points_payment', ?, ?, ?
      WHERE (SELECT COALESCE(SUM(CASE WHEN status = 'AVAILABLE' THEN points END), 0) + COALESCE(SUM(CASE WHEN status = 'PENDING' AND points < 0 THEN points END), 0) FROM rewards_ledger WHERE member_id = ?) >= ?`)
      .bind(memberId, -pts, reference, `Paid with Star Points (${{ tickets: 'match tickets', food: 'MatchDay Kitchen', shop: 'shop order' }[kind]})`, reference, memberId, pts).run();
    if (!r.meta.changes) { await releaseCheckout(env, reference); return { error: 'Not enough Star Points for that.' }; }
  }
  return { pointsUsed: pts, pointsKobo, voucherCode: voucher ? code : null, voucherKobo, totalKobo: subtotalKobo - voucherKobo - pointsKobo };
}

/** Payment confirmed: the held points are taken and the voucher is used (safe to repeat). */
export async function confirmCheckout(env, reference) {
  try {
    const db = env.DB;
    await ensureCatalogueSchema(db);
    await db.batch([
      db.prepare(`UPDATE rewards_ledger SET status = 'AVAILABLE', available_at = ? WHERE source = 'points_payment' AND source_ref = ? AND status = 'PENDING'`).bind(new Date().toISOString(), reference),
      db.prepare(`UPDATE rewards_redemptions SET status = 'used', updated_at = datetime('now') WHERE status = 'reserved' AND provider_ref = ?`).bind(reference),
    ]);
  } catch (err) { console.error('[rewards] confirm checkout', err); }
}

/** Payment failed or abandoned: the points and the voucher are given back (safe to repeat). */
export async function releaseCheckout(env, reference) {
  try {
    const db = env.DB;
    await ensureCatalogueSchema(db);
    await db.batch([
      db.prepare(`UPDATE rewards_ledger SET status = 'REVERSED' WHERE source = 'points_payment' AND source_ref = ? AND status = 'PENDING'`).bind(reference),
      db.prepare(`UPDATE rewards_redemptions SET status = 'issued', provider_ref = NULL, updated_at = datetime('now') WHERE status = 'reserved' AND provider_ref = ?`).bind(reference),
    ]);
  } catch (err) { console.error('[rewards] release checkout', err); }
}

/** The Rewards job: releases holds whose payment was never completed (after `minutes`). */
export async function releaseAbandoned(env, minutes = 90) {
  const db = env.DB;
  await ensureCatalogueSchema(db);
  const cutoff = new Date(Date.now() - minutes * 60e3).toISOString().replace('T', ' ').slice(0, 19);
  const { results } = await db.prepare(`SELECT DISTINCT source_ref AS ref FROM rewards_ledger WHERE source = 'points_payment' AND status = 'PENDING' AND created_at < ?
    UNION SELECT provider_ref FROM rewards_redemptions WHERE status = 'reserved' AND updated_at < ?`).bind(cutoff, cutoff).all();
  let n = 0;
  for (const { ref } of results) {
    if (!ref) continue;
    const paid = await db.prepare(`SELECT 1 FROM league_ticket_orders WHERE reference = ? AND status = 'paid'
      UNION SELECT 1 FROM food_orders WHERE paystack_reference = ? AND payment_status = 'paid'
      UNION SELECT 1 FROM shirt_orders WHERE paystack_reference = ? AND payment_status = 'paid'`).bind(ref, ref, ref).first().catch(() => null);
    if (paid) await confirmCheckout(env, ref); else { await releaseCheckout(env, ref); n++; }
  }
  return n;
}

let cols = false;
/** Order columns recording what was paid with points or a voucher (safe to run every time). */
export async function ensureCheckoutColumns(db) {
  if (cols) return;
  const add = async (t, defs) => {
    let have;
    try { have = new Set((await db.prepare(`PRAGMA table_info(${t})`).all()).results.map(c => c.name)); } catch { return; }
    if (!have.size) return;
    for (const [c, d] of defs) if (!have.has(c)) await db.prepare(`ALTER TABLE ${t} ADD COLUMN ${c} ${d}`).run().catch(err => { if (!/duplicate column/i.test(String(err))) throw err; });
  };
  await add('league_ticket_orders', [['points_used', 'INTEGER NOT NULL DEFAULT 0'], ['points_kobo', 'INTEGER NOT NULL DEFAULT 0']]);
  for (const t of ['food_orders', 'shirt_orders']) await add(t, [['points_used', 'INTEGER NOT NULL DEFAULT 0'], ['points_kobo', 'INTEGER NOT NULL DEFAULT 0'], ['voucher_code', 'TEXT'], ['voucher_kobo', 'INTEGER NOT NULL DEFAULT 0']]);
  cols = true;
}
