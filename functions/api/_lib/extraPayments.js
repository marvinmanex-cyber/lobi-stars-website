// Paystack payments other than tickets and food: online membership and
// personalised shirts. Used by the webhook (the source of truth) and by
// /api/payments/verify (the page fans return to), so both are safe to run
// more than once.
import { ensureMembershipSchema, setMembership } from './membership.js';
import { ensureShirtSchema, shirtOrderEmailHtml } from './shirtOrders.js';
import { sendEmail } from './email.js';
import { verifyTransaction } from './paystack.js';
import { captureContact, splitName } from './contacts.js';

/** Finds a membership payment or shirt order by Paystack reference. */
export async function findPayment(db, reference) {
  await ensureMembershipSchema(db);
  await ensureShirtSchema(db);
  const m = await db.prepare(`SELECT * FROM membership_payments WHERE paystack_reference = ?`).bind(reference).first();
  if (m) return { kind: 'membership', row: m, paid: m.status === 'paid', amount: m.amount_kobo };
  const s = await db.prepare(`SELECT * FROM shirt_orders WHERE paystack_reference = ?`).bind(reference).first();
  if (s) return { kind: 'shirt', row: s, paid: s.payment_status === 'paid', amount: s.total_kobo };
  return null;
}

/** Marks a found payment as paid (once) and does what it pays for. */
export async function fulfilPayment(env, found, waitUntil) {
  const now = new Date().toISOString();
  if (found.kind === 'membership') {
    const res = await env.DB.prepare(`UPDATE membership_payments SET status = 'paid', paid_at = ? WHERE id = ? AND status != 'paid'`).bind(now, found.row.id).run();
    if (res.meta?.changes) await setMembership(env.DB, found.row.member_id, { season: found.row.season, source: 'online', note: `Paystack ${found.row.paystack_reference}` });
    return;
  }
  const res = await env.DB.prepare(`UPDATE shirt_orders SET payment_status = 'paid', paid_at = ? WHERE id = ? AND payment_status != 'paid'`).bind(now, found.row.id).run();
  if (res.meta?.changes) {
    const n = splitName(found.row.buyer_name);
    await captureContact(env, { source: 'shop_order', refTable: 'shirt_orders', refId: found.row.id, email: found.row.buyer_email, phone: found.row.buyer_phone, firstName: n.firstName, surname: n.surname, label: found.row.product_name });
  }
  if (res.meta?.changes && env.RESEND_API_KEY) {
    const send = sendEmail(env, { to: found.row.buyer_email, subject: `Your Lobi Stars shirt order ${found.row.id}`, html: shirtOrderEmailHtml(found.row) })
      .then(() => env.DB.prepare(`UPDATE shirt_orders SET emailed = 1 WHERE id = ?`).bind(found.row.id).run())
      .catch(err => console.error('[shirt] email failed', err));
    if (waitUntil) waitUntil(send); else await send;
  }
}

/** For the return page: checks with Paystack if the webhook hasn't arrived yet. */
export async function verifyPayment(env, reference, waitUntil) {
  let found = await findPayment(env.DB, reference);
  if (!found) return null;
  if (!found.paid && env.PAYSTACK_SECRET_KEY) {
    try {
      const p = await verifyTransaction(env.PAYSTACK_SECRET_KEY, reference);
      if (p.status === 'success' && p.amount === found.amount) {
        await fulfilPayment(env, found, waitUntil);
        found = await findPayment(env.DB, reference);
      }
    } catch (err) { console.error('[payments] verify failed', err); }
  }
  return found;
}
