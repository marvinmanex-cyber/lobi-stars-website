// "Pause all online ticket sales": one switch stops online ticket buying for every
// home match (catalogue, basket checkout and the old single-match checkout), shows the
// fans' message, and resuming brings back each match's own settings.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './media-helpers.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const admin = (method, body) => fetch(`${BASE}/api/admin/tickets`, { method, headers: ADMIN, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, d: await r.json().catch(() => ({})) }));
after(async () => { await admin('POST', { action: 'pause', paused: false, message: '' }); });

test('pause stops online ticket sales with the message; resume restores them', async () => {
  const before = (await fetch(`${BASE}/api/tickets/catalogue`).then(r => r.json()));
  const onSale = before.matches.filter(m => m.state === 'on_sale').map(m => m.id);
  const p = await admin('POST', { action: 'pause', paused: true, message: 'Online tickets open soon. Test message.' });
  assert.equal(p.status, 200, JSON.stringify(p.d)); assert.equal(p.d.pause.paused, true);
  assert.equal((await admin('GET')).d.pause.paused, true);
  const cat = await fetch(`${BASE}/api/tickets/catalogue`).then(r => r.json());
  assert.equal(cat.pause.message, 'Online tickets open soon. Test message.');
  assert.ok(!cat.matches.some(m => m.state === 'on_sale'), 'nothing on sale while paused');
  const basket = await fetch(`${BASE}/api/tickets/basket`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines: [{ eventId: onSale[0] || 'x', tier: 'VIP', quantity: 1 }], buyer: { name: 'A B', email: 'a@example.com', phone: '08031234567' } }) });
  assert.equal(basket.status, 409); assert.match((await basket.json()).error, /Test message/);
  const single = await fetch(`${BASE}/api/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(single.status, 409);
  const matches = await fetch(`${BASE}/api/matches`).then(r => r.json());
  assert.ok(!(matches.matches || []).some(m => m.ticket?.state === 'on_sale'), 'fixtures show not on sale');
  assert.equal((await admin('POST', { action: 'pause', paused: false, message: 'Online tickets open soon. Test message.' })).d.pause.paused, false);
  const back = await fetch(`${BASE}/api/tickets/catalogue`).then(r => r.json());
  assert.equal(back.pause, null);
  assert.deepEqual(back.matches.filter(m => m.state === 'on_sale').map(m => m.id), onSale, 'each match back to its own settings');
});
