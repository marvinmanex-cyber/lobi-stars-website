// Season tickets: off until staff switch them on; prices from the server;
// stands with a limit can't be oversold; payment (fake Paystack) creates the
// passes; the gate admits a pass once per home match, only on a match day;
// cancelled passes are refused; /verify shows a genuine pass; roles.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123,
// PAYSTACK_FAKE=1 and STAFF_SCAN_CODE=scan-test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const SCAN = process.env.STAFF_SCAN_CODE || 'scan-test';
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const api = (path, method = 'GET', body, headers = ADMIN) => fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const pub = (path, body) => api(path, 'POST', body, { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() });
const settings = (over = {}) => api('/api/admin/season-tickets', 'POST', { settings: { enabled: true, season: '2026/27', info: '', tiers: { VIP: { priceNaira: 50000, limit: 0 }, Premium: { priceNaira: 25000, limit: 3 }, Regular: { priceNaira: 0, limit: 0 } }, ...over } });
after(async () => { await settings({ enabled: false }); });

async function buy(tier = 'VIP', quantity = 1, pay = true) {
  const r = await pub('/api/season-tickets/checkout', { tier, quantity, buyerName: `Season Fan ${uid()}`, buyerEmail: `season-${uid()}@example.com`, buyerPhone: `0803${String(Math.random()).slice(2, 9)}` });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  if (pay) {
    const amount = { VIP: 5000000, Premium: 2500000 }[tier] * quantity;
    await pub('/api/dev/paystack-fake', { reference: r.data.reference, status: 'success', amount });
  }
  return (await api(`/api/season-tickets/order?reference=${r.data.reference}`, 'GET', null, {})).data;
}
const gate = id => api('/api/validate-ticket', 'POST', { ticketId: id, staffCode: SCAN, station: 'test' }, { 'Content-Type': 'application/json' });

test('off by default for fans; settings validated', async () => {
  await settings({ enabled: false });
  assert.deepEqual((await api('/api/season-tickets', 'GET', null, {})).data, { enabled: false });
  assert.equal((await pub('/api/season-tickets/checkout', { tier: 'VIP', quantity: 1, buyerName: 'X Y', buyerEmail: 'x@example.com', buyerPhone: '08031234567' })).status, 409);
  assert.equal((await settings({ season: '2026' })).status, 400);
  assert.equal((await settings({ tiers: { VIP: { priceNaira: 0, limit: 0 }, Premium: { priceNaira: 0, limit: 0 }, Regular: { priceNaira: 0, limit: 0 } } })).status, 400, 'needs a price to switch on');
  assert.equal((await settings()).status, 200);
  const info = (await api('/api/season-tickets', 'GET', null, {})).data;
  assert.equal(info.enabled, true);
  assert.deepEqual(info.tiers.map(t => [t.tier, t.priceKobo]), [['VIP', 5000000], ['Premium', 2500000]], 'Regular (price 0) not on sale');
});

test('buying: price from the server, passes after payment, limits, wrong amount refused', async () => {
  // A season of its own, so stand limits start from zero on every run.
  const y = 2100 + Math.floor(Math.random() * 800);
  await settings({ season: `${y}/${String((y + 1) % 100).padStart(2, '0')}` });
  const unpaid = await buy('VIP', 2, false);
  assert.equal(unpaid.paid, false);
  const o = await buy('VIP', 2);
  assert.equal(o.paid, true);
  assert.equal(o.passes.length, 2);
  assert.ok(o.passes.every(p => /^LS-SZN-[A-Z0-9]{12}$/.test(p)));
  // Premium has 3 season tickets: 2 + 2 is one too many.
  const p1 = await buy('Premium', 2);
  assert.equal(p1.passes.length, 2);
  const over = await pub('/api/season-tickets/checkout', { tier: 'Premium', quantity: 2, buyerName: 'Too Many', buyerEmail: `m-${uid()}@example.com`, buyerPhone: '08031234500' });
  assert.equal(over.status, 409); assert.match(over.data.error, /Only 1 left/);
  assert.equal((await pub('/api/season-tickets/checkout', { tier: 'Regular', quantity: 1, buyerName: 'No Sale', buyerEmail: `n-${uid()}@example.com`, buyerPhone: '08031234501' })).status, 409);
  assert.equal((await pub('/api/season-tickets/checkout', { tier: 'VIP', quantity: 5, buyerName: 'Five', buyerEmail: `f-${uid()}@example.com`, buyerPhone: '08031234502' })).status, 400);
  // Paystack reports a different amount: not paid.
  const r = await pub('/api/season-tickets/checkout', { tier: 'VIP', quantity: 1, buyerName: 'Cheat Er', buyerEmail: `c-${uid()}@example.com`, buyerPhone: '08031234503' });
  await pub('/api/dev/paystack-fake', { reference: r.data.reference, status: 'success', amount: 100 });
  assert.equal((await api(`/api/season-tickets/order?reference=${r.data.reference}`, 'GET', null, {})).data.paid, false);
});

test('gate: once per home match, only on match days; cancelled passes refused; verify page', async () => {
  await settings();
  const o = await buy('VIP', 1);
  const pass = o.passes[0];
  // No home match today yet (depending on other tests' data): make one now.
  const ev = await api('/api/admin/events', 'POST', { home_team: 'Lobi Stars FC', away_team: `Gate Test ${uid()}`, competition: 'NNL', venue: 'McCarthy Stadium, Makurdi', event_date: new Date(Date.now() + 2 * 3600e3).toISOString(), vip_price_kobo: 0, premium_price_kobo: 0, regular_price_kobo: 0, active: true });
  assert.equal(ev.status, 200);
  assert.equal((await api('/api/validate-ticket', 'POST', { ticketId: pass, staffCode: 'wrong' }, { 'Content-Type': 'application/json' })).status, 401);
  const first = await gate(pass.toLowerCase());
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.valid, true);
  assert.equal(first.data.ticket.season, true);
  const again = await gate(pass);
  assert.equal(again.status, 409); assert.match(again.data.reason, /Already used for this match/);
  const verify = await (await fetch(`${BASE}/verify/${pass}`)).text();
  assert.match(verify, /VALID SEASON TICKET/); assert.match(verify, /Used for 1 match/);
  assert.ok(!verify.includes(o.name), 'no personal details on the public check');
  assert.equal((await api('/api/admin/season-tickets', 'POST', { voidPass: pass })).status, 200);
  assert.equal((await gate(o.passes[0])).data.reason, 'Season ticket void');
  assert.match(await (await fetch(`${BASE}/verify/${pass}`)).text(), /CANCELLED/);
  assert.equal((await gate('LS-SZN-NOTREAL00000')).status, 404);
  const admin = (await api('/api/admin/season-tickets')).data;
  assert.ok(admin.totals.passes >= 1 && admin.totals.gateScans >= 1);
  assert.ok(admin.passes.some(p => p.id === pass && p.status === 'void' && p.used === 1));
});

test('roles: the Matchday Operations Manager (tickets) manages season tickets; Commercial and Media cannot', async () => {
  const login = async role => {
    const email = `sz-${role}-${uid()}@example.com`;
    await api('/api/admin/staff', 'POST', { name: `SZ ${role}`, email, password: 'Role-Test-2026!', role });
    const l = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
    return { Cookie: l.headers.get('set-cookie').split(';')[0] };
  };
  assert.equal((await api('/api/admin/season-tickets', 'GET', null, await login('matchday_ops_manager'))).status, 200);
  assert.equal((await api('/api/admin/season-tickets', 'GET', null, await login('commercial'))).status, 403);
  assert.equal((await api('/api/admin/season-tickets', 'GET', null, await login('media'))).status, 403);
});
