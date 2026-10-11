// In-seat food, phase 2: staff alerts, live board data, orders list.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123,
// PAYSTACK_SECRET_KEY=sk_test_local and PAYSTACK_FAKE=1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, webcrypto } from 'node:crypto';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const SECRET = process.env.PAYSTACK_SECRET_KEY || 'sk_test_local';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const r7 = () => String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const admin = (path, method = 'GET', body) => fetch(BASE + path, { method, headers: ADMIN, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));

async function order(seat = 'D7') {
  const r = await fetch(`${BASE}/api/food-checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ name: 'Alert Tester', seat, stand: '', phone: `0803${r7()}`, email: `a-${uid()}@example.com`, items: [{ id: 'water', qty: 2 }] }) }).then(r => r.json());
  assert.ok(r.ref, JSON.stringify(r));
  return { ref: r.ref, id: r.orderId, total: 2 * 30000 };
}
async function pay(o) {
  await fetch(`${BASE}/api/dev/paystack-fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference: o.ref, status: 'success', amount: o.total }) });
  const body = JSON.stringify({ event: 'charge.success', data: { reference: o.ref, amount: o.total } });
  return fetch(`${BASE}/api/paystack-webhook`, { method: 'POST', headers: { 'x-paystack-signature': createHmac('sha512', SECRET).update(body).digest('hex') }, body });
}
async function alertsFor(ref) {
  for (let i = 0; i < 10; i++) {
    const { data } = await admin('/api/admin/food-alerts?after=0');
    const mine = data.alerts.filter(a => a.ref === ref);
    if (mine.length) return { mine, data };
    await sleep(300);
  }
  return { mine: [], data: {} };
}

test('a new order raises one "awaiting payment" alert; payment raises one "PAID" alert, even if the webhook repeats', async () => {
  const o = await order('D7');
  let { mine } = await alertsFor(o.ref);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].kind, 'unpaid');
  assert.match(mine[0].title, new RegExp(`New order – awaiting payment: ${o.ref}`));
  assert.match(mine[0].body, /Alert Tester, Seat D7, ₦600/);

  await pay(o); await pay(o); await pay(o);
  await sleep(500);
  ({ mine } = await alertsFor(o.ref));
  const paid = mine.filter(a => a.kind === 'paid');
  assert.equal(paid.length, 1, 'one paid alert only');
  assert.match(paid[0].title, /PAID – start preparing/);
  assert.match(paid[0].body, /2× Bottled Water/);
  const latest = await admin('/api/admin/food-alerts?latest=1');
  assert.ok(latest.data.alert);
});

test('alerts need staff access; alert settings and device sign-up are validated', async () => {
  assert.equal((await fetch(`${BASE}/api/admin/food-alerts`)).status, 401);
  assert.equal((await admin('/api/admin/food-alerts/settings', 'POST', { emails: 'not-an-email' })).status, 400);
  assert.equal((await admin('/api/admin/food-alerts/settings', 'POST', { smsNumbers: '12' })).status, 400);
  const ok = await admin('/api/admin/food-alerts/settings', 'POST', { push: true, emailPaid: true, emailUnpaid: false, emails: 'kitchen@example.com', sms: false, smsNumbers: '', smsChannel: 'generic' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data.settings.emails, ['kitchen@example.com']);
  assert.equal(ok.data.settings.emailUnpaid, false);
  assert.equal((await admin('/api/admin/food-alerts/subscribe', 'POST', { subscription: { endpoint: 'http://insecure.example' } })).status, 400);
  const ep = `https://push.example.com/${uid()}`;
  assert.equal((await admin('/api/admin/food-alerts/subscribe', 'POST', { subscription: { endpoint: ep, keys: { p256dh: 'x', auth: 'y' } }, wantPaid: true })).status, 200);
  assert.equal((await admin('/api/admin/food-alerts/subscribe', 'DELETE', { endpoint: ep })).status, 200);
  await admin('/api/admin/food-alerts/settings', 'POST', { push: true, emailPaid: true, emailUnpaid: false, emails: '', sms: false, smsNumbers: '', smsChannel: 'generic' });
});

test('the live board shows awaiting and paid orders; moves update it; the stream sends live changes', async () => {
  const a = await order('E1'), p = await order('E2');
  await pay(p);
  let b = (await admin('/api/admin/food-orders?show=board')).data.orders;
  assert.equal(b.find(o => o.ref === a.ref).status, 'AWAITING_PAYMENT');
  assert.equal(b.find(o => o.ref === p.ref).status, 'PAID');
  for (const s of ['PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED']) assert.equal((await admin('/api/admin/food-orders', 'POST', { id: p.id, status: s })).status, 200);
  b = (await admin('/api/admin/food-orders?show=board')).data.orders;
  const done = b.find(o => o.ref === p.ref);
  assert.equal(done.status, 'DELIVERED', 'delivered orders stay on the board for 30 minutes');
  assert.equal(done.statusBy, 'Owner (admin code)');

  const ctrl = new AbortController();
  const res = await fetch(`${BASE}/api/admin/food-orders/stream`, { headers: ADMIN, signal: ctrl.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body.getReader();
  let text = '';
  const until = Date.now() + 8000;
  while (!text.includes('event: change') && Date.now() < until) text += new TextDecoder().decode((await reader.read()).value || new Uint8Array());
  ctrl.abort();
  assert.match(text, /event: change/);
});

test('orders list: search and filters; Excel export for staff allowed to export', async () => {
  const o = await order('F9');
  const byRef = await admin(`/api/admin/food-orders?show=list&q=${o.ref}`);
  assert.equal(byRef.data.orders.length, 1);
  assert.equal(byRef.data.orders[0].ref, o.ref);
  const unpaid = await admin(`/api/admin/food-orders?show=list&status=AWAITING_PAYMENT&q=${o.ref}`);
  assert.equal(unpaid.data.orders.length, 1);
  const paidOnly = await admin(`/api/admin/food-orders?show=list&pay=paid&q=${o.ref}`);
  assert.equal(paidOnly.data.orders.length, 0);
  const x = await fetch(`${BASE}/api/admin/food-orders?show=list&format=xlsx&q=${o.ref}`, { headers: ADMIN });
  assert.equal(x.status, 200);
  assert.match(x.headers.get('content-type'), /spreadsheetml/);
  const buf = new Uint8Array(await x.arrayBuffer());
  assert.equal(String.fromCharCode(buf[0], buf[1]), 'PK', 'a real .xlsx (zip) file');
});

test('push signature (VAPID) is a valid ES256 token for the push service', async () => {
  const { vapidAuth } = await import('../functions/api/_lib/foodAlerts.js');
  const kp = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', kp.privateKey);
  const raw = new Uint8Array(await webcrypto.subtle.exportKey('raw', kp.publicKey));
  const b64u = b => Buffer.from(b).toString('base64url');
  const env = { VAPID_PUBLIC_KEY: b64u(raw), VAPID_PRIVATE_KEY: jwk.d, VAPID_SUBJECT: 'mailto:test@example.com' };
  const header = await vapidAuth(env, 'https://fcm.googleapis.com/fcm/send/abc');
  const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, env.VAPID_PUBLIC_KEY);
  const [h, p, sig] = jwt.split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'mailto:test@example.com');
  const ok = await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, Buffer.from(sig, 'base64url'), new TextEncoder().encode(`${h}.${p}`));
  assert.equal(ok, true);
});
