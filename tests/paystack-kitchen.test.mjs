// The kitchen's Paystack webhook against a running server. The server needs
// PAYSTACK_FAKE=1, PAYSTACK_SECRET_KEY=sk_test_local and PAYSTACK_KITCHEN_SECRET_KEY=sk_test_kitchen_local.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { sql } from './media-helpers.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const MAIN = 'sk_test_local', KITCHEN = 'sk_test_kitchen_local';
const T = Date.now().toString(36).toUpperCase();
const rows = q => JSON.parse(sql(q))[0].results;
const hook = (path, key, event) => { const raw = JSON.stringify(event); return fetch(`${BASE}/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': createHmac('sha512', key).update(raw).digest('hex') }, body: raw }); };
const charge = (reference, amount) => ({ event: 'charge.success', data: { reference, amount, currency: 'NGN' } });
const fake = (reference, amount, status = 'success') => fetch(`${BASE}/api/dev/paystack-fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference, amount, status }) });
const put = id => `INSERT INTO food_orders (id, ref, seat, stand, phone, email, items_json, total_kobo, paystack_reference, payment_status, order_status, created_iso, channel, customer_name) VALUES ('${id}', '${id}', 'A1', 'Popular Stand', '+2348031234567', '', '[{"id":"none","name":"Suya","qty":1,"priceKobo":150000}]', 150000, '${id}', 'pending', 'AWAITING_PAYMENT', '${new Date().toISOString()}', 'paystack', 'Webhook Fan');`;
const status = id => rows(`SELECT order_status, payment_status FROM food_orders WHERE id = '${id}'`)[0];

test('the kitchen webhook: only its own key, only food orders, only payments Paystack confirms', async () => {
  const [a, b, c, d] = ['A', 'B', 'C', 'D'].map(x => `FD-WH${x}${T}`);
  sql(put(a) + put(b) + put(c) + put(d));
  try {
    // A signature from the wrong key, or none: refused, and nothing changes.
    await fake(a, 150000);
    assert.equal((await hook('paystack-webhook-kitchen', MAIN, charge(a, 150000))).status, 401, 'the main key does not open the kitchen webhook');
    assert.equal((await hook('paystack-webhook-kitchen', 'wrong', charge(a, 150000))).status, 401);
    assert.equal((await fetch(`${BASE}/api/paystack-webhook-kitchen`, { method: 'POST', body: '{}' })).status, 401, 'no signature');
    assert.equal(status(a).payment_status, 'pending');
    // The kitchen key cannot be used on the main webhook either (that one can issue tickets).
    assert.equal((await hook('paystack-webhook', KITCHEN, charge(a, 150000))).status, 401, 'the kitchen key does not open the main webhook');
    // Wrong amount: refused.
    assert.equal((await hook('paystack-webhook-kitchen', KITCHEN, charge(a, 100))).status, 400);
    assert.equal(status(a).payment_status, 'pending');
    // Signed, but Paystack says it was not paid: stays unpaid.
    await fake(b, 150000, 'abandoned');
    assert.equal((await hook('paystack-webhook-kitchen', KITCHEN, charge(b, 150000))).status, 200);
    assert.equal(status(b).payment_status, 'pending');
    // The real thing: paid, and a repeat changes nothing.
    assert.equal((await hook('paystack-webhook-kitchen', KITCHEN, charge(a, 150000))).status, 200);
    assert.deepEqual({ ...status(a) }, { order_status: 'PAID', payment_status: 'paid' });
    assert.equal((await hook('paystack-webhook-kitchen', KITCHEN, charge(a, 150000))).status, 200);
    assert.ok(rows(`SELECT value FROM settings WHERE key = 'paystack_kitchen_last_webhook'`)[0], 'Website Health sees it');
    // Anything that isn't a food order is ignored, whatever it is.
    assert.equal(await (await hook('paystack-webhook-kitchen', KITCHEN, charge(`LSBAS-NOPE${T}`, 150000))).text(), 'Ignored');
    assert.equal(await (await hook('paystack-webhook-kitchen', KITCHEN, { event: 'transfer.success', data: {} })).text(), 'Ignored');
    assert.equal((await hook('paystack-webhook-kitchen', KITCHEN, { event: 'refund.processed', data: { transaction_reference: `LSBAS-NOPE${T}` } })).status, 200);
    // An order started on the main account before the switch still finishes on the main webhook.
    await fake(c, 150000);
    assert.equal((await hook('paystack-webhook', MAIN, charge(c, 150000))).status, 200);
    assert.equal(status(c).payment_status, 'paid');
    // Paystack says the payment failed: the order shows that, and is not paid.
    await fake(d, 150000, 'failed');
    assert.equal((await hook('paystack-webhook-kitchen', KITCHEN, charge(d, 150000))).status, 200);
    assert.equal(status(d).order_status, 'PAYMENT_FAILED');
  } finally {
    sql(`DELETE FROM food_orders WHERE id IN ('${a}', '${b}', '${c}', '${d}');`);
  }
});
