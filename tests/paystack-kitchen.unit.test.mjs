// MatchDay Kitchen's own Paystack account: which secret key each kind of payment uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialize, initializeFood, verify, verifyFood, kitchenKey } from '../functions/api/_lib/paystackClient.js';

const MAIN = 'sk_test_main', KITCHEN = 'sk_test_kitchen';
const opts = { email: 'a@example.com', amountKobo: 100, reference: 'FD-1', callbackUrl: 'https://x.test/' };

/** Pretend Paystack: each account knows only the references listed for it. */
function paystack(known) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const key = init.headers.Authorization.replace('Bearer ', '');
    calls.push(key);
    if (String(url).includes('/initialize')) return Response.json({ status: true, data: { authorization_url: `https://pay.test/${key}` } });
    const ref = String(url).split('/').pop();
    if (known[key]?.includes(ref)) return Response.json({ status: true, data: { status: 'success', amount: 100, currency: 'NGN', reference: ref } });
    return Response.json({ status: false, message: 'Transaction reference not found' }, { status: 400 });
  };
  return calls;
}

test('no kitchen key yet: kitchen payments stay on the main account', async () => {
  const env = { PAYSTACK_SECRET_KEY: MAIN };
  assert.equal(kitchenKey(env), MAIN);
  const calls = paystack({ [MAIN]: ['FD-1'] });
  await initializeFood(env, opts);
  assert.equal((await verifyFood(env, 'FD-1')).status, 'success');
  assert.deepEqual(calls, [MAIN, MAIN], 'the main account, once each');
});

test('kitchen key set: kitchen payments use it; tickets stay on the main account', async () => {
  const env = { PAYSTACK_SECRET_KEY: MAIN, PAYSTACK_KITCHEN_SECRET_KEY: KITCHEN };
  const calls = paystack({ [KITCHEN]: ['FD-1'], [MAIN]: ['LSBAS-1'] });
  assert.match((await initializeFood(env, opts)).authorization_url, /sk_test_kitchen/);
  assert.equal((await verifyFood(env, 'FD-1')).reference, 'FD-1');
  assert.deepEqual(calls, [KITCHEN, KITCHEN], 'the main account was never asked');
  calls.length = 0;
  assert.match((await initialize(env, opts)).authorization_url, /sk_test_main/);
  assert.equal((await verify(env, 'LSBAS-1')).status, 'success');
  assert.deepEqual(calls, [MAIN, MAIN], 'tickets never use the kitchen key');
});

test('an order started on the main account before the switch still confirms', async () => {
  const env = { PAYSTACK_SECRET_KEY: MAIN, PAYSTACK_KITCHEN_SECRET_KEY: KITCHEN };
  const calls = paystack({ [MAIN]: ['FD-OLD'] });
  assert.equal((await verifyFood(env, 'FD-OLD')).status, 'success');
  assert.deepEqual(calls, [KITCHEN, MAIN]);
});

test('a payment neither account knows is an error, not a payment', async () => {
  const env = { PAYSTACK_SECRET_KEY: MAIN, PAYSTACK_KITCHEN_SECRET_KEY: KITCHEN };
  paystack({});
  await assert.rejects(verifyFood(env, 'FD-NONE'), /not found/);
});
