// Paystack calls used by in-seat food ordering, with a FAKE mode for local
// automated tests only. Fake mode is on only when the server has the
// environment variable PAYSTACK_FAKE=1 (never set it on the live site): it
// keeps a small table of "transactions" that tests create through
// /api/dev/paystack-fake, so payment confirmation can be tested end to end
// without real keys. In normal mode the real Paystack API is used.
import { initializeTransaction, verifyTransaction, refundTransaction } from './paystack.js';

export const isFake = env => env.PAYSTACK_FAKE === '1';

async function ensureFake(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS paystack_fake (
    reference TEXT PRIMARY KEY, status TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'NGN'
  )`).run();
}

export async function initialize(env, opts) {
  if (isFake(env)) return { authorization_url: `${opts.callbackUrl}${opts.callbackUrl.includes('?') ? '&' : '?'}trxref=${encodeURIComponent(opts.reference)}&reference=${encodeURIComponent(opts.reference)}&fake=1`, reference: opts.reference };
  return initializeTransaction(env.PAYSTACK_SECRET_KEY, opts);
}

/** Paystack's own record of a transaction: { status, amount, currency, reference } (throws if Paystack can't be reached). */
export async function verify(env, reference) {
  if (isFake(env)) {
    await ensureFake(env.DB);
    const t = await env.DB.prepare(`SELECT * FROM paystack_fake WHERE reference = ?`).bind(reference).first();
    return t ? { status: t.status, amount: t.amount, currency: t.currency, reference } : { status: 'abandoned', amount: 0, currency: 'NGN', reference };
  }
  const d = await verifyTransaction(env.PAYSTACK_SECRET_KEY, reference);
  return { status: d.status, amount: d.amount, currency: d.currency, reference: d.reference };
}

// ── MatchDay Kitchen's own Paystack account ──
// With PAYSTACK_KITCHEN_SECRET_KEY set, food payments go to the kitchen's account; everything else
// (tickets, membership, shirts) stays on the main one. Without it, food uses the main account.
export const kitchenKey = env => env.PAYSTACK_KITCHEN_SECRET_KEY || env.PAYSTACK_SECRET_KEY;

export async function initializeFood(env, opts) {
  if (isFake(env)) return initialize(env, opts);
  return initializeTransaction(kitchenKey(env), opts);
}

/** Paystack's record of a food payment. An order started on the main account before the switch is found there. */
export async function verifyFood(env, reference) {
  if (isFake(env) || !env.PAYSTACK_KITCHEN_SECRET_KEY) return verify(env, reference);
  let d;
  try { d = await verifyTransaction(env.PAYSTACK_KITCHEN_SECRET_KEY, reference); }
  catch (err) {
    if (!env.PAYSTACK_SECRET_KEY) throw err;
    try { d = await verifyTransaction(env.PAYSTACK_SECRET_KEY, reference); } catch { throw err; }
  }
  return { status: d.status, amount: d.amount, currency: d.currency, reference: d.reference };
}

/** Refunds a food payment on the account that took it. */
export async function refundFood(env, reference, amountKobo) {
  if (isFake(env)) return { status: 'pending', fake: true };
  if (!env.PAYSTACK_KITCHEN_SECRET_KEY) return refundTransaction(env.PAYSTACK_SECRET_KEY, reference, amountKobo);
  try { return await refundTransaction(env.PAYSTACK_KITCHEN_SECRET_KEY, reference, amountKobo); }
  catch (err) {
    if (!env.PAYSTACK_SECRET_KEY) throw err;
    try { return await refundTransaction(env.PAYSTACK_SECRET_KEY, reference, amountKobo); } catch { throw err; }
  }
}

export async function setFakeTransaction(env, { reference, status = 'success', amount, currency = 'NGN' }) {
  await ensureFake(env.DB);
  await env.DB.prepare(`INSERT INTO paystack_fake (reference, status, amount, currency) VALUES (?, ?, ?, ?)
    ON CONFLICT (reference) DO UPDATE SET status = excluded.status, amount = excluded.amount, currency = excluded.currency`)
    .bind(reference, status, amount, currency).run();
}
