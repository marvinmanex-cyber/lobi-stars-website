// Paystack calls used by in-seat food ordering, with a FAKE mode for local
// automated tests only. Fake mode is on only when the server has the
// environment variable PAYSTACK_FAKE=1 (never set it on the live site): it
// keeps a small table of "transactions" that tests create through
// /api/dev/paystack-fake, so payment confirmation can be tested end to end
// without real keys. In normal mode the real Paystack API is used.
import { initializeTransaction, verifyTransaction } from './paystack.js';

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

export async function setFakeTransaction(env, { reference, status = 'success', amount, currency = 'NGN' }) {
  await ensureFake(env.DB);
  await env.DB.prepare(`INSERT INTO paystack_fake (reference, status, amount, currency) VALUES (?, ?, ?, ?)
    ON CONFLICT (reference) DO UPDATE SET status = excluded.status, amount = excluded.amount, currency = excluded.currency`)
    .bind(reference, status, amount, currency).run();
}
