// Ticketing engine integration (docs/INTEGRATION_CONTRACT.md): the real handlers of this site,
// an in-memory database (helpers/d1shim.mjs) and a mock engine that follows the contract
// (helpers/mockEngine.mjs). No network beyond 127.0.0.1; emails are caught, not sent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { d1 } from './helpers/d1shim.mjs';
import { startMockEngine, signedCallback } from './helpers/mockEngine.mjs';
import { signRequest, verifySigned, sha256Hex, engine, engineFetch, fanMessage, safeEqual } from '../functions/api/_lib/ticketing/engineClient.js';
import { ensureEngineSchema, setSetting, ticketingStatus, intlPhone, qrTextFor, isEngineToken, SETTING_PROCESSOR, SETTING_IMPORT_CONFIRMED, _forgetProcessorName } from '../functions/api/_lib/ticketing/engineStore.js';
import { standTier, matchLocal, _resetEngineMemo } from '../functions/api/_lib/ticketing/engineCatalogue.js';
import { plainPricing } from '../functions/api/_lib/ticketing/engineOrders.js';
import { catalogue } from '../functions/api/_lib/ticketShop.js';
import { onRequestPost as basketPost, onRequestGet as basketGet } from '../functions/api/tickets/basket.js';
import { onRequestPost as pricePost } from '../functions/api/tickets/price.js';
import { onRequestPost as lookupPost } from '../functions/api/tickets/lookup.js';
import { onRequestPost as callbackPost } from '../functions/internal/ticketing/callback.js';
import { onRequestGet as processorGet } from '../functions/api/tickets/processor.js';
import { onRequestGet as settingsGet } from '../functions/api/admin/ticketing-settings.js';
import { checkTicket, parseTicketInput } from '../functions/api/_lib/gateCheck.js';
import { syncOffline } from '../functions/api/_lib/gateExtras.js';
import { ensureMatchdaySchema } from '../functions/api/_lib/gateMatchday.js';
import { permissionForPath, allowedPath } from '../functions/api/_lib/adminRoles.js';

const SITE = 'https://lobistarsfc.com';
const KICKOFF = new Date(Date.now() + 5 * 86400e3).toISOString().replace(/\.\d+Z$/, 'Z');
const LOCAL_ID = 'ev-local-1';
const ENGINE_EVENTS = [{
  event_id: 'eng-ev-1', name: 'Lobi Stars FC vs Kano Pillars', kickoff_at: KICKOFF, venue: 'McCarthy Stadium, Makurdi',
  sale_open: new Date(Date.now() - 86400e3).toISOString(), sale_close: KICKOFF,
  stands: [{ stand_id: 's-vip', name: 'VIP Sitting', price_kobo: 500000, available: 50 }, { stand_id: 's-pop', name: 'Popular Stand', price_kobo: 150000, available: 2 }],
}];
let mock, env, emails = [];
const realFetch = globalThis.fetch;
const who = { user: { id: 'dev-1', name: 'Main Gate phone', code: 'SCN-1' }, gate: 'Main Gate' };
const post = (path, body, headers = {}) => new Request(`${SITE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.0.0.${(Math.random() * 250) | 0}`, ...headers }, body: JSON.stringify(body) });
const wait = [];
const waitUntil = p => { wait.push(p); };
const settle = () => Promise.all(wait.splice(0));
const buyer = { buyerName: 'Ada Okafor', buyerEmail: 'ada@example.com', buyerPhone: '0803 123 4567' };

before(async () => {
  mock = await startMockEngine({ events: ENGINE_EVENTS });
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.resend.com')) { emails.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: 'em_1' }), { status: 200 }); }
    return realFetch(url, init);
  };
  const DB = d1();
  DB.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  env = {
    DB, TICKETING_BACKEND: 'engine', TICKETING_API_BASE_URL: mock.base, TICKETING_API_KEY: mock.key, TICKETING_API_SECRET: mock.secret,
    TICKETING_CALLBACK_SECRET: 'callback-secret-new', TICKETING_CALLBACK_SECRET_PREVIOUS: 'callback-secret-old', RESEND_API_KEY: 're_test',
    ASSETS: { fetch: async () => new Response('', { status: 404 }) },
  };
  await ensureEngineSchema(DB);
  // Tables the live site has (League and Gate Control), used by the ticket views and the gate.
  DB.exec(`CREATE TABLE IF NOT EXISTS league_fixtures (id TEXT PRIMARY KEY, event_id TEXT, matchday INTEGER, status TEXT)`);
  await DB.prepare(`INSERT INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo, active, is_home) VALUES (?, 'Lobi Stars FC', 'Kano Pillars', 'NNL', ?, 'McCarthy Stadium, Makurdi', 400000, 250000, 100000, 1, 1)`).bind(LOCAL_ID, KICKOFF).run();
});
after(async () => { globalThis.fetch = realFetch; await mock.close(); });

// ── C2: signatures ──
test('signature: the contract string, HMAC-SHA256 hex, checked against Node crypto', async () => {
  const h = await signRequest({ key: 'k1', secret: 's3cret', method: 'post', pathWithQuery: '/api/partner/v1/orders?x=1', body: '{"a":1}', timestamp: 1764000000, nonce: 'abcdef0123456789' });
  const bodyHash = crypto.createHash('sha256').update('{"a":1}').digest('hex');
  const expect = crypto.createHmac('sha256', 's3cret').update(`1764000000.abcdef0123456789.POST./api/partner/v1/orders?x=1.${bodyHash}`).digest('hex');
  assert.equal(h['X-Signature'], expect);
  assert.equal(h['X-Partner-Key'], 'k1'); assert.equal(h['X-Timestamp'], '1764000000');
  assert.equal(await sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'); // empty body
  assert.ok(safeEqual('abc', 'abc') && !safeEqual('abc', 'abd') && !safeEqual('abc', 'abcd'));
});

test('signature checks: good, rotated secret, wrong secret, old timestamp, short nonce, replay', async () => {
  const seen = new Set(), nonceSeen = async n => (seen.has(n) ? true : (seen.add(n), false));
  const now = Math.floor(Date.now() / 1000);
  const mk = async (secret, extra = {}) => ({ headers: await signRequest({ key: 'e', secret, method: 'POST', pathWithQuery: '/internal/ticketing/callback', body: '{}', timestamp: now, ...extra }) });
  const check = async (h, o = {}) => verifySigned({ secrets: ['new', 'old'], method: 'POST', pathWithQuery: '/internal/ticketing/callback', rawBody: '{}', headers: h.headers, nonceSeen, ...o });
  assert.equal((await check(await mk('new'))).ok, true);
  assert.equal((await check(await mk('old'))).ok, true, 'the previous secret still works during a rotation');
  assert.equal((await check(await mk('wrong'))).code, 'invalid_signature');
  assert.equal((await check(await mk('new', { timestamp: now - 301 }))).why, 'timestamp');
  assert.equal((await check(await mk('new', { nonce: 'short' }))).why, 'nonce');
  const once = await mk('new');
  assert.equal((await check(once)).ok, true);
  assert.equal((await check(once)).why, 'replay', 'the same nonce twice is refused');
  assert.equal((await verifySigned({ secrets: [], method: 'POST', pathWithQuery: '/', headers: {} })).code, 'not_configured');
});

// ── C3: every endpoint against the mock engine ──
test('contract: events, order (idempotent), order by id and by reference, lookup, validate, scan, batch', async () => {
  const ev = await engine.events(env);
  assert.equal(ev.events[0].event_id, 'eng-ev-1');
  const req = { client_reference: 'LSBAS-CONTRACT0001', season_bundle: false, items: [{ event_id: 'eng-ev-1', stand_id: 's-vip', quantity: 1 }], buyer: { name: 'A', email: 'a@example.com', phone: '+2348031234567' }, return_url: `${SITE}/tickets/success/` };
  const o1 = await engine.createOrder(env, req, 'idem-key-1'), o2 = await engine.createOrder(env, req, 'idem-key-1');
  assert.equal(o1.order_id, o2.order_id, 'the same Idempotency-Key gives the original order, never a duplicate');
  assert.equal(o1.amount_total_kobo, 500000); assert.equal(o1.status, 'pending_payment'); assert.ok(o1.payment.authorization_url);
  assert.equal((await engine.getOrder(env, o1.order_id)).status, 'pending_payment');
  mock.pay('LSBAS-CONTRACT0001');
  const byRef = await engine.orderByReference(env, 'LSBAS-CONTRACT0001');
  assert.equal(byRef.status, 'paid'); assert.equal(byRef.tickets.length, 1);
  const tok = byRef.tickets[0].token;
  assert.ok(isEngineToken(tok));
  assert.equal((await engine.lookup(env, 'a@example.com', 'LSBAS-CONTRACT0001')).tickets.length, 1);
  assert.equal((await engine.lookup(env, 'nobody@example.com', 'LSBAS-CONTRACT0001')).tickets.length, 0);
  assert.equal((await engine.validate(env, tok)).valid, true);
  const s1 = await engine.scan(env, { token: tok, scan_id: crypto.randomUUID(), gate_id: 'g', device_id: 'd', scanned_at: new Date().toISOString() });
  assert.equal(s1.result, 'admitted');
  assert.equal((await engine.scan(env, { token: tok, scan_id: crypto.randomUUID(), gate_id: 'g', device_id: 'd', scanned_at: new Date().toISOString() })).result, 'already_scanned');
  const b = await engine.scanBatch(env, [{ token: 'NOPENOPENOPENOPENOPENOPE', scan_id: crypto.randomUUID(), gate_id: 'g', device_id: 'd', scanned_at: new Date().toISOString() }], 'batch-1');
  assert.equal(b.results[0].result, 'invalid');
  for (const c of mock.state.calls.filter(c => c.method === 'POST')) assert.ok(c.idem, `${c.path} carries an Idempotency-Key`);
});

test('client: GET is retried after a 5xx, POST is not; errors become the site\'s own words', async () => {
  const before = mock.state.calls.length;
  mock.state.failNext = { status: 503, times: 1 };
  assert.equal((await engine.events(env)).events.length, 1, 'GET retried once and then answered');
  assert.equal(mock.state.calls.length - before, 2);
  mock.state.failNext = { status: 500, times: 1 };
  const n = mock.state.calls.length;
  await assert.rejects(engineFetch(env, 'POST', '/tickets/validate', { body: { token: 'X' } }), e => e.status === 500 && e.unreachable);
  assert.equal(mock.state.calls.length - n, 1, 'a POST that reached the engine is never repeated');
  assert.equal(fanMessage({ code: 'sold_out' }), 'Sorry, those tickets have just sold out. Check your order and try again.');
  assert.equal(fanMessage({ code: 'weird_internal_thing' }), 'Payment could not be started. Please try again.');
  await assert.rejects(engineFetch({ ...env, TICKETING_API_BASE_URL: 'http://engine.example.com' }, 'GET', '/events'), e => e.code === 'not_configured', 'plain http is refused (except localhost)');
});

// ── helpers ──
test('mapping and small helpers', () => {
  assert.equal(standTier({ stand_id: 'x', name: 'VIP Sitting' }), 'VIP');
  assert.equal(standTier({ stand_id: 'Premium', name: '' }), 'Premium');
  assert.equal(standTier({ stand_id: 'y', name: 'Popular Stand' }), 'Regular');
  assert.equal(standTier({ stand_id: 'z', name: 'Press box' }), null);
  assert.equal(matchLocal({ kickoff_at: KICKOFF, name: 'x' }, [{ id: 'a', event_date: KICKOFF, away_team: 'Kano' }])?.id, 'a');
  assert.equal(matchLocal({ kickoff_at: new Date(Date.parse(KICKOFF) + 5 * 3600e3).toISOString() }, [{ id: 'a', event_date: KICKOFF }]), null);
  assert.equal(intlPhone('0803 123 4567'), '+2348031234567');
  assert.equal(intlPhone('2348031234567'), '+2348031234567');
  const tok = 'ABCDEFGHIJKLMNOPQRSTUVWX2345';
  assert.equal(qrTextFor(tok), tok, 'an engine ticket QR holds the token and nothing else');
  assert.equal(qrTextFor('LS-TIX-ABCD2345EFGH'), `${SITE}/verify/LS-TIX-ABCD2345EFGH`);
  assert.deepEqual(parseTicketInput(tok.toLowerCase()), { token: tok });
  assert.deepEqual(plainPricing({ lines: [{ eventId: 'e', quantity: 2, totalKobo: 1000 }], totalKobo: 1000 }).matches[0].tickets, 2);
});

// ── The switch ──
test('engine mode only switches on with the secrets AND the payment processor name', async () => {
  _forgetProcessorName();
  await setSetting(env.DB, SETTING_PROCESSOR, '', 'test');
  let s = await ticketingStatus(env);
  assert.equal(s.active, 'legacy'); assert.match(s.blockers.join(' '), /legal name/);
  assert.equal((await ticketingStatus({ ...env, TICKETING_API_SECRET: '' })).active, 'legacy');
  assert.equal((await ticketingStatus({ ...env, TICKETING_BACKEND: 'legacy' })).active, 'legacy');
  // Legacy mode: the match list never asks the engine.
  const calls = mock.state.calls.length; _resetEngineMemo();
  const legacyCat = await catalogue(env);
  assert.equal(legacyCat.engine, null); assert.equal(mock.state.calls.length, calls);
  assert.equal((await (await processorGet({ env })).json()).name, null, 'nothing named while not in engine mode');
  await setSetting(env.DB, SETTING_PROCESSOR, 'Test Processor Ltd', 'test');
  s = await ticketingStatus(env);
  assert.equal(s.active, 'engine');
  assert.equal((await (await processorGet({ env })).json()).name, 'Test Processor Ltd');
});

test('match list in engine mode: engine prices, seats and sale times; a stand it does not sell is "opening soon"', async () => {
  _resetEngineMemo();
  const cat = await catalogue(env);
  const c = cat.get(LOCAL_ID);
  assert.equal(c.ticket.state, 'on_sale');
  const t = Object.fromEntries(c.ticket.tiers.map(x => [x.tier, x]));
  assert.equal(t.VIP.priceKobo, 500000, 'the engine price, not the local one'); assert.equal(t.VIP.remaining, 50);
  assert.equal(t.Regular.priceKobo, 150000); assert.equal(t.Regular.remaining, 2);
  assert.equal(t.Premium.soon, true);
  const price = await (await pricePost({ request: post('/api/tickets/price', { lines: [{ eventId: LOCAL_ID, tier: 'VIP', quantity: 2 }] }), env })).json();
  assert.equal(price.totalKobo, 1000000); assert.equal(price.discountKobo, 0);
});

// ── Checkout, callback, return page, lookup ──
let paidRef, tokens = [];
test('checkout: the order is made in the engine and copied here; the fan gets the payment page', async () => {
  const r = await basketPost({ request: post('/api/tickets/basket', { lines: [{ eventId: LOCAL_ID, tier: 'VIP', quantity: 2 }], expectedTotalKobo: 1000000, ...buyer }), env, waitUntil });
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  assert.equal(d.authorizationUrl, 'https://checkout.paystack.com/test123');
  assert.match(d.reference, /^LSBAS-/);
  paidRef = d.reference;
  const b = await env.DB.prepare(`SELECT * FROM league_ticket_orders WHERE reference = ?`).bind(paidRef).first();
  assert.equal(b.backend, 'engine'); assert.equal(b.total_kobo, 1000000); assert.ok(b.engine_order_id);
  const lines = (await env.DB.prepare(`SELECT * FROM orders WHERE basket_id = ?`).bind(b.id).all()).results;
  assert.equal(lines.length, 1); assert.equal(lines[0].quantity, 2); assert.equal(lines[0].tier, 'VIP');
  assert.equal(mock.state.byRef.get(paidRef).buyer.phone, '+2348031234567', 'the phone goes in +234 form');
});

test('checkout: a price change at the engine is shown first (409), nothing is paid', async () => {
  mock.state.priceBump = 1000;
  const r = await basketPost({ request: post('/api/tickets/basket', { lines: [{ eventId: LOCAL_ID, tier: 'VIP', quantity: 1 }], expectedTotalKobo: 500000, ...buyer }), env, waitUntil });
  mock.state.priceBump = 0;
  const d = await r.json();
  assert.equal(r.status, 409); assert.equal(d.code, 'repriced'); assert.equal(d.pricing.totalKobo, 501000);
});

test('checkout: sold out, too many and family tickets give the site\'s usual messages', async () => {
  let r = await basketPost({ request: post('/api/tickets/basket', { lines: [{ eventId: LOCAL_ID, tier: 'Regular', quantity: 3 }], ...buyer }), env, waitUntil });
  assert.equal(r.status, 409); assert.match((await r.json()).error, /Only 2 Popular Stand tickets left/);
  r = await basketPost({ request: post('/api/tickets/basket', { lines: [{ eventId: LOCAL_ID, tier: 'VIP', family: true, adults: 1, children: 1 }], ...buyer }), env, waitUntil });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /Family and child tickets/);
  r = await basketPost({ request: post('/api/tickets/basket', { lines: [{ eventId: LOCAL_ID, tier: 'Premium', quantity: 1 }], ...buyer }), env, waitUntil });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /opening soon/);
});

test('callback: wrong signature 401; order.paid issues the tickets and ONE email with the processor line; a repeat does nothing', async () => {
  const o = mock.pay(paidRef);
  const body = { event_id: crypto.randomUUID(), type: 'order.paid', occurred_at: new Date().toISOString(), order: { order_id: o.order_id, client_reference: paidRef, status: 'paid', amount_total_kobo: o.amount_total_kobo, paid_at: o.paid_at }, tickets: o.tickets };
  let r = await callbackPost({ request: await signedCallback({ secret: 'not-the-secret', body }), env, waitUntil });
  assert.equal(r.status, 401); assert.equal((await r.json()).error.code, 'invalid_signature');
  emails = [];
  r = await callbackPost({ request: await signedCallback({ secret: 'callback-secret-new', body }), env, waitUntil });
  await settle();
  assert.equal(r.status, 200);
  const b = await env.DB.prepare(`SELECT * FROM league_ticket_orders WHERE reference = ?`).bind(paidRef).first();
  assert.equal(b.status, 'paid');
  const t = (await env.DB.prepare(`SELECT * FROM tickets WHERE order_id IN (SELECT id FROM orders WHERE basket_id = ?)`).bind(b.id).all()).results;
  assert.equal(t.length, 2);
  tokens = t.map(x => x.id);
  assert.ok(tokens.every(isEngineToken), 'the ticket number is the engine token');
  assert.equal(emails.length, 1, 'one email');
  assert.match(emails[0].html, /Payments processed by Test Processor Ltd\./);
  assert.match(emails[0].from, /lobistarsfc\.com/, 'sent from the club domain');
  // The same callback again (the engine retries): 200, nothing new.
  r = await callbackPost({ request: await signedCallback({ secret: 'callback-secret-old', body }), env, waitUntil });
  await settle();
  assert.equal(r.status, 200); assert.equal((await r.json()).duplicate, true);
  assert.equal(emails.length, 1, 'no second email');
});

test('return page: paid order with its tickets and the processor line; pending orders ask the engine', async () => {
  let d = await (await basketGet({ request: new Request(`${SITE}/api/tickets/basket?reference=${paidRef}`), env, waitUntil })).json();
  assert.equal(d.paid, true); assert.equal(d.processedBy, 'Test Processor Ltd');
  assert.equal(d.matches[0].tickets.length, 2);
  // A second order whose callback never comes: the return page polls GET /orders/{id}.
  const r = await basketPost({ request: post('/api/tickets/basket', { lines: [{ eventId: LOCAL_ID, tier: 'VIP', quantity: 1 }], expectedTotalKobo: 500000, ...buyer }), env, waitUntil });
  const ref = (await r.json()).reference;
  mock.pay(ref);
  d = await (await basketGet({ request: new Request(`${SITE}/api/tickets/basket?reference=${ref}`), env, waitUntil })).json();
  await settle();
  assert.equal(d.paid, true, 'finished from the poll, without a callback'); assert.equal(d.matches[0].tickets.length, 1);
});

test('Find my tickets: backed by the engine, same answer and at least 450 ms whether found or not', async () => {
  const t0 = Date.now();
  const miss = await lookupPost({ request: post('/api/tickets/lookup', { email: 'nobody@example.com', reference: paidRef }), env, waitUntil });
  const t1 = Date.now();
  const hit = await lookupPost({ request: post('/api/tickets/lookup', { email: 'ada@example.com', reference: paidRef }), env, waitUntil });
  assert.equal(miss.status, 404); assert.equal((await miss.json()).error, 'No paid order matches that email and reference.');
  assert.ok(t1 - t0 >= 440, 'a miss is not faster');
  const d = await hit.json();
  assert.equal(hit.status, 200); assert.equal(d.matches[0].tickets.length, 2); assert.equal(d.processedBy, 'Test Processor Ltd');
  assert.ok(mock.state.calls.some(c => c.path.endsWith('/tickets/lookup')), 'the engine was asked');
});

// ── Gate ──
test('gate: local rules first, then the engine: admit once, then ALREADY USED; look up changes nothing', async () => {
  const [a, b] = tokens;
  // The club's banned list is checked here first: the engine is never asked to admit a banned fan.
  await ensureMatchdaySchema(env.DB);
  await env.DB.prepare(`INSERT INTO gc_banned (kind, value, reason, added_at) VALUES ('ticket', ?, 'Pitch invasion', ?)`).bind(a, new Date().toISOString()).run();
  const before = mock.state.calls.filter(c => c.path.endsWith('/tickets/scan')).length;
  let r = await checkTicket(env, a, { mode: 'admit', how: 'camera', who });
  assert.equal(r.code, 'banned');
  assert.equal(mock.state.calls.filter(c => c.path.endsWith('/tickets/scan')).length, before, 'refused here, before the engine');
  await env.DB.prepare(`UPDATE gc_banned SET removed_at = ? WHERE value = ?`).bind(new Date().toISOString(), a).run();
  r = await checkTicket(env, a, { mode: 'lookup', how: 'camera', who });
  assert.equal(r.code, 'valid');
  r = await checkTicket(env, a, { mode: 'admit', how: 'camera', who, force: true });
  assert.equal(r.code, 'admitted', JSON.stringify(r));
  assert.equal((await env.DB.prepare(`SELECT status FROM tickets WHERE id = ?`).bind(a).first()).status, 'used');
  r = await checkTicket(env, a, { mode: 'admit', how: 'typed', who, force: true });
  assert.equal(r.code, 'used');
  // Voided and wrong-match tickets (the engine decides).
  mock.state.tickets.get(b).wrong = true;
  r = await checkTicket(env, b, { mode: 'admit', how: 'camera', who, force: true });
  assert.equal(r.code, 'wrong_match');
  mock.state.tickets.get(b).wrong = false; mock.state.tickets.get(b).status = 'void';
  r = await checkTicket(env, b, { mode: 'admit', how: 'camera', who, force: true });
  assert.equal(r.code, 'void');
  r = await checkTicket(env, 'QQQQQQQQQQQQQQQQQQQQQQQQ', { mode: 'admit', how: 'camera', who, force: true });
  assert.equal(r.code, 'fake');
});

test('gate: engine down -> CANNOT VERIFY (never admitted); offline sync then throws so the phone keeps its queue', async () => {
  const r0 = await basketPost({ request: post('/api/tickets/basket', { lines: [{ eventId: LOCAL_ID, tier: 'VIP', quantity: 2 }], expectedTotalKobo: 1000000, ...buyer }), env, waitUntil });
  const ref = (await r0.json()).reference;
  const o = mock.pay(ref);
  await callbackPost({ request: await signedCallback({ secret: 'callback-secret-new', body: { event_id: crypto.randomUUID(), type: 'order.paid', occurred_at: new Date().toISOString(), order: { order_id: o.order_id, client_reference: ref, status: 'paid' }, tickets: o.tickets } }), env, waitUntil });
  await settle();
  const [c, d] = o.tickets.map(t => t.token);
  mock.state.down = true;
  const r = await checkTicket(env, c, { mode: 'admit', how: 'camera', who, force: true });
  assert.equal(r.code, 'cannot_verify'); assert.match(r.reason, /Do not admit yet/);
  assert.equal((await env.DB.prepare(`SELECT status FROM tickets WHERE id = ?`).bind(c).first()).status, 'valid');
  const req = new Request(`${SITE}/api/gate-control/sync`, { method: 'POST' });
  await assert.rejects(syncOffline(env, [{ ticket: c, at: new Date().toISOString() }], who, req));
  mock.state.down = false;
  // Offline sync: one batch; the earliest check-in wins; the same check-in sent twice is not a double.
  const t1 = new Date(Date.now() - 120e3).toISOString(), t2 = new Date(Date.now() - 60e3).toISOString();
  let s = await syncOffline(env, [{ ticket: c, at: t1 }, { ticket: d, at: t2 }], who, req);
  assert.equal(s.admitted, 2); assert.deepEqual(s.doubles, []);
  s = await syncOffline(env, [{ ticket: c, at: t1 }], who, req);
  assert.equal(s.admitted, 1, 'sent again: the same answer, not a double entry');
  s = await syncOffline(env, [{ ticket: c, at: new Date().toISOString() }], { ...who, user: { ...who.user, id: 'dev-2' } }, req);
  assert.deepEqual(s.doubles, [c], 'another phone let the same ticket in later: a double entry');
  assert.ok(mock.state.calls.some(x => x.path.endsWith('/tickets/scan/batch')));
});

test('gate: old LS-TIX tickets stay local until the import is confirmed, then go to the engine', async () => {
  await setSetting(env.DB, SETTING_IMPORT_CONFIRMED, '0', 'test');
  const n = mock.state.calls.length;
  let r = await checkTicket(env, 'LS-TIX-ABCD2345EFGH', { mode: 'lookup', how: 'typed', who });
  assert.equal(r.code, 'fake'); assert.equal(mock.state.calls.length, n, 'checked locally, the engine not asked');
  await setSetting(env.DB, SETTING_IMPORT_CONFIRMED, '1', 'test');
  r = await checkTicket(env, 'LS-TIX-ABCD2345EFGH', { mode: 'lookup', how: 'typed', who });
  assert.ok(mock.state.calls.length > n, 'now the engine is asked');
  await setSetting(env.DB, SETTING_IMPORT_CONFIRMED, '0', 'test');
});

// ── Refunds and voids by callback ──
test('callback: order.refunded voids the tickets that were not used', async () => {
  const r0 = await basketPost({ request: post('/api/tickets/basket', { lines: [{ eventId: LOCAL_ID, tier: 'VIP', quantity: 1 }], expectedTotalKobo: 500000, ...buyer }), env, waitUntil });
  const ref = (await r0.json()).reference;
  const o = mock.pay(ref);
  const send = type => callbackPost({ request: signedCallback({ secret: 'callback-secret-new', body: { event_id: crypto.randomUUID(), type, occurred_at: new Date().toISOString(), order: { order_id: o.order_id, client_reference: ref, status: type === 'order.refunded' ? 'refunded' : 'paid' }, tickets: o.tickets } }), env, waitUntil });
  await callbackPost({ request: await signedCallback({ secret: 'callback-secret-new', body: { event_id: crypto.randomUUID(), type: 'order.paid', occurred_at: new Date().toISOString(), order: { order_id: o.order_id, client_reference: ref, status: 'paid' }, tickets: o.tickets } }), env, waitUntil });
  await callbackPost({ request: await signedCallback({ secret: 'callback-secret-new', body: { event_id: crypto.randomUUID(), type: 'order.refunded', occurred_at: new Date().toISOString(), order: { order_id: o.order_id, client_reference: ref, status: 'refunded' }, tickets: o.tickets.map(t => ({ ...t, status: 'void' })) } }), env, waitUntil });
  await settle();
  void send;
  const b = await env.DB.prepare(`SELECT status FROM league_ticket_orders WHERE reference = ?`).bind(ref).first();
  assert.equal(b.status, 'refunded');
  assert.equal((await env.DB.prepare(`SELECT status FROM tickets WHERE id = ?`).bind(o.tickets[0].token).first()).status, 'void');
});

test('callback: an order this site never made is logged as unmatched (200, nothing created)', async () => {
  const r = await callbackPost({ request: await signedCallback({ secret: 'callback-secret-new', body: { event_id: crypto.randomUUID(), type: 'order.paid', occurred_at: new Date().toISOString(), order: { order_id: 'ord_unknown', client_reference: 'LSBAS-NOTOURS00000', status: 'paid' }, tickets: [] } }), env, waitUntil });
  assert.equal(r.status, 200); assert.equal((await r.json()).unmatched, true);
  assert.ok(await env.DB.prepare(`SELECT 1 FROM ticketing_log WHERE kind = 'unmatched_order'`).first());
});

// ── Access ──
test('integration settings: Super Admins only, on the server', async () => {
  assert.equal(permissionForPath('/api/admin/ticketing-settings', 'GET'), undefined, 'not given to any role: Super Admin only');
  for (const role of ['commercial_manager', 'matchday_admin', 'content_editor', 'kitchen_staff']) assert.equal(allowedPath({ role }, '/api/admin/ticketing-settings', 'GET'), false, role);
  assert.equal(allowedPath({ role: 'super_admin' }, '/api/admin/ticketing-settings', 'GET'), true);
  const r = await settingsGet({ request: new Request(`${SITE}/api/admin/ticketing-settings`), env });
  assert.equal(r.status, 403, 'not signed in');
});
