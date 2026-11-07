// The order workflow's rules: every status move for every role, reasons, who is told, muting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canMove, reasonProblem, recipientsFor, alarmsFor, muteProblem, isLoud, seesMoney, EVENTS, eventOf, STAFF } from '../functions/api/_lib/kitchenWorkflow.js';
import { STAFF_MOVES, STATUS, REJECT_REASONS, staffMessage, FOOD_DEFAULTS } from '../functions/api/_lib/foodOrders.js';
import { customerMessage, customerUpdate, whatsappConnected } from '../functions/api/_lib/kitchenCustomer.js';
import { dueEscalations, preorderHeld, refundProblem, cleanVenuePatch, VENUE_DEFAULTS as V } from '../functions/api/_lib/kitchenOps.js';

const { SA, SUP, PASS, COOK, RUN } = STAFF;
const ALL = Object.keys(STATUS);
const seat = s => ({ order_status: s, fulfilment: 'seat' });
const pick = s => ({ order_status: s, fulfilment: 'pickup' });

test('every move: only the listed forward moves are allowed, for every role', () => {
  for (const role of [SA, SUP, PASS, COOK, RUN]) for (const from of ALL) for (const to of ALL) {
    const r = canMove(role, seat(from), to);
    if (!(STAFF_MOVES[from] || []).includes(to)) assert.equal(r?.status, 409, `${role} ${from} > ${to} must be refused`);
  }
  // No going backwards, for anyone.
  for (const [from, to] of [['ACCEPTED', 'PAID'], ['PREPARING', 'ACCEPTED'], ['READY', 'PREPARING'], ['OUT_FOR_DELIVERY', 'READY'], ['DELIVERED', 'OUT_FOR_DELIVERY'], ['CANCELLED', 'PAID']]) {
    assert.equal(canMove(SA, seat(from), to)?.status, 409, `${from} > ${to}`);
  }
  assert.deepEqual(STAFF_MOVES.DELIVERED, []);
  assert.deepEqual(STAFF_MOVES.REFUNDED, []);
});

test('who may do each move', () => {
  const allow = (role, from, to, o = seat) => assert.equal(canMove(role, o(from), to), null, `${role} ${from} > ${to}`);
  const deny = (role, from, to, o = seat) => assert.equal(canMove(role, o(from), to)?.status, 403, `${role} ${from} > ${to}`);
  // Confirming and rejecting: supervisors and Super Admins.
  for (const r of [SA, SUP]) { allow(r, 'PAID', 'ACCEPTED'); allow(r, 'PAID', 'REJECTED'); allow(r, 'AWAITING_WHATSAPP', 'CONFIRMED'); allow(r, 'AWAITING_WHATSAPP', 'REJECTED'); }
  for (const r of [PASS, COOK, RUN]) { deny(r, 'PAID', 'ACCEPTED'); deny(r, 'PAID', 'REJECTED'); deny(r, 'AWAITING_WHATSAPP', 'CONFIRMED'); deny(r, 'PAID', 'PREPARING'); }
  // Cancelling, from any step before delivery: supervisors and Super Admins.
  for (const from of ['AWAITING_WHATSAPP', 'CONFIRMED', 'PAID', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'FAILED_DELIVERY']) {
    allow(SUP, from, 'CANCELLED'); allow(SA, from, 'CANCELLED');
    for (const r of [PASS, COOK, RUN]) deny(r, from, 'CANCELLED');
  }
  // Cooking.
  for (const r of [SA, SUP, PASS, COOK]) { allow(r, 'ACCEPTED', 'PREPARING'); allow(r, 'PREPARING', 'READY'); }
  deny(RUN, 'ACCEPTED', 'PREPARING'); deny(RUN, 'PREPARING', 'READY');
  // Delivering.
  for (const r of [SA, SUP, PASS, RUN]) { allow(r, 'READY', 'OUT_FOR_DELIVERY'); allow(r, 'OUT_FOR_DELIVERY', 'DELIVERED'); allow(r, 'OUT_FOR_DELIVERY', 'FAILED_DELIVERY'); }
  deny(COOK, 'READY', 'OUT_FOR_DELIVERY'); deny(COOK, 'OUT_FOR_DELIVERY', 'DELIVERED');
  // After a failed delivery a supervisor decides.
  allow(SUP, 'FAILED_DELIVERY', 'READY'); deny(RUN, 'FAILED_DELIVERY', 'READY'); deny(PASS, 'FAILED_DELIVERY', 'READY');
  // Pickup orders skip the runner; seat orders can't.
  allow(PASS, 'READY', 'DELIVERED', pick); allow(RUN, 'READY', 'DELIVERED', pick);
  assert.equal(canMove(SA, seat('READY'), 'DELIVERED')?.status, 409);
  // The kitchen area always goes through Ready.
  assert.equal(canMove(SA, seat('PREPARING'), 'OUT_FOR_DELIVERY')?.status, 409);
  // Refunds: Super Admins only.
  allow(SA, 'REJECTED', 'REFUNDED'); allow(SA, 'CANCELLED', 'REFUNDED'); deny(SUP, 'REJECTED', 'REFUNDED');
});

test('a rejection or a cancellation needs a reason', () => {
  assert.match(reasonProblem('REJECTED', {}), /why/);
  assert.match(reasonProblem('REJECTED', { reason: 'nonsense' }), /why/);
  for (const r of Object.keys(REJECT_REASONS).filter(x => x !== 'other')) assert.equal(reasonProblem('REJECTED', { reason: r }), null);
  assert.match(reasonProblem('REJECTED', { reason: 'other' }), /note/);
  assert.equal(reasonProblem('REJECTED', { reason: 'other', note: 'Power cut' }), null);
  assert.match(reasonProblem('CANCELLED', {}), /why/);
  assert.equal(reasonProblem('CANCELLED', { note: 'Fan left' }), null);
  assert.equal(reasonProblem('READY', {}), null);
});

const devices = [
  { endpoint: 'sa1', role: SA, staffId: 'A1' }, { endpoint: 'sa2', role: SA, staffId: 'A2' }, { endpoint: 'sup', role: SUP, staffId: 'S' },
  { endpoint: 'cook', role: COOK, staffId: 'C' }, { endpoint: 'run', role: RUN, staffId: 'R' }, { endpoint: 'pass', role: PASS, staffId: 'P' }, { endpoint: 'screen', role: 'screen', staffId: 'X' },
];
const to = (event, o) => recipientsFor(event, devices, o).map(d => d.endpoint).sort();

test('who is told about every event', () => {
  assert.deepEqual(to('ORDER_NEW'), ['sa1', 'sa2', 'screen', 'sup']);
  assert.deepEqual(to('ORDER_ACCEPTED'), ['cook', 'pass', 'sa1', 'sa2', 'sup']);
  assert.deepEqual(to('ORDER_REJECTED'), ['sa1', 'sa2', 'sup']);
  assert.deepEqual(to('ORDER_READY'), ['pass', 'run', 'sa1', 'sa2', 'sup']);
  assert.deepEqual(to('ORDER_OUT_FOR_DELIVERY'), ['sa1', 'sa2', 'sup']);
  assert.deepEqual(to('ORDER_DELIVERED'), ['sa1', 'sa2', 'sup']);
  assert.deepEqual(to('ORDER_CANCELLED'), ['sa1', 'sa2', 'screen', 'sup']);
  assert.deepEqual(to('ORDER_CANCELLED', { cookWasPreparing: true }), ['cook', 'sa1', 'sa2', 'screen', 'sup']);
  assert.deepEqual(to('ORDER_FAILED_DELIVERY', { cookWasPreparing: true }), ['cook', 'sa1', 'sa2', 'sup']);
  assert.deepEqual(to('MISSING_INGREDIENT'), ['sa1', 'sa2', 'sup']);
  assert.deepEqual(to('NOT_AN_EVENT'), []);
  for (const a of ['initial', 'repeat', 'whatsapp']) assert.equal(eventOf(a), 'ORDER_NEW');
  assert.equal(eventOf('cook'), 'ORDER_ACCEPTED');
  assert.ok(isLoud('ORDER_NEW', SUP)); assert.ok(isLoud('ORDER_ACCEPTED', COOK)); assert.ok(isLoud('ORDER_READY', RUN));
  assert.ok(!isLoud('ORDER_ACCEPTED', SA)); assert.ok(!isLoud('ORDER_DELIVERED', SUP));
  assert.ok(Object.keys(EVENTS).length >= 9);
});

test('Super Admin mute levels, and nobody else can mute', () => {
  assert.deepEqual(to('ORDER_NEW', { levels: { A1: 'off' } }), ['sa2', 'screen', 'sup']);
  assert.deepEqual(to('ORDER_READY', { levels: { A1: 'urgent' } }), ['pass', 'run', 'sa2', 'sup'], 'urgent only: not a routine event');
  assert.deepEqual(to('ORDER_NEW', { levels: { A1: 'urgent' } }), ['sa1', 'sa2', 'screen', 'sup'], 'urgent only: still hears a new order');
  assert.deepEqual(to('ORDER_NEW', { levels: { S: 'off', C: 'off' } }), ['sa1', 'sa2', 'screen', 'sup'], 'a level for anyone else is ignored');
});

test('safety rule: an active venue is never left with nobody alerted', () => {
  const noSup = devices.filter(d => d.role !== SUP);
  const heard = o => recipientsFor('ORDER_NEW', noSup, o).map(d => d.endpoint).sort();
  const off = { A1: 'off', A2: 'off' };
  assert.deepEqual(heard({ levels: off }), ['sa1', 'sa2', 'screen'], 'no fallback set: every Super Admin');
  assert.deepEqual(heard({ levels: off, fallbackId: 'A2' }), ['sa2', 'screen'], 'the fallback alone');
  assert.deepEqual(recipientsFor('ORDER_DELIVERED', noSup, { levels: off }).map(d => d.endpoint), [], 'routine events can stay quiet');

  assert.equal(muteProblem('urgent', {}), null);
  assert.equal(muteProblem('all', {}), null);
  assert.equal(muteProblem('off', { supervisorOnDuty: true }), null);
  assert.equal(muteProblem('off', { otherAdminsHearing: 1 }), null);
  assert.equal(muteProblem('off', { fallbackId: 'A2', selfId: 'A1' }), null);
  assert.match(muteProblem('off', { selfId: 'A1' }), /can't switch off/);
  assert.match(muteProblem('off', { fallbackId: 'A1', selfId: 'A1' }), /can't switch off/, 'you can\'t be your own fallback');
});

test('each role\'s alarms in the app', () => {
  const lists = { newOrders: [1], whatsapp: [2], cook: [3], ready: [4], late: [5], failed: [6], flags: [7] };
  const has = (role, level = 'all') => Object.entries(alarmsFor(role, level, lists)).filter(([, v]) => v.length).map(([k]) => k).sort();
  assert.deepEqual(has(SUP), ['cook', 'failed', 'flags', 'late', 'newOrders', 'ready', 'whatsapp']);
  assert.deepEqual(has(SA), ['cook', 'failed', 'flags', 'late', 'newOrders', 'ready', 'whatsapp']);
  assert.deepEqual(has(SA, 'urgent'), ['failed', 'flags', 'late', 'newOrders', 'whatsapp']);
  assert.deepEqual(has(SA, 'off'), []);
  assert.deepEqual(has(SUP, 'off'), ['cook', 'failed', 'flags', 'late', 'newOrders', 'ready', 'whatsapp'], 'a supervisor can\'t be muted');
  assert.deepEqual(has(COOK), ['cook']);
  assert.deepEqual(has(RUN), ['ready']);
  assert.deepEqual(has(PASS), ['cook', 'late', 'ready']);
  assert.ok(!seesMoney(COOK)); assert.ok(!seesMoney(RUN)); assert.ok(seesMoney(SUP)); assert.ok(seesMoney(PASS));
});

const order = { id: 'o1', ref: 'FD-1', customer_name: 'George Okoro', phone: '+2348031234567', email: 'g@example.com', total_kobo: 150000, payment_status: 'paid', order_status: 'REJECTED', reject_reason: 'sold_out', seat: 'A1', items_json: '[{"name":"Suya","qty":1}]', view_token: 'tok', channel: 'whatsapp' };

test('customer messages: no staff names, the reason and refund on a rejection', () => {
  const m = customerMessage({}, order, 'rejected');
  assert.match(m.text, /Hi George/); assert.match(m.text, /An item is sold out/); assert.match(m.text, /refunded/); assert.match(m.text, /FD-1/);
  assert.match(customerMessage({}, order, 'out').text, /on its way/);
  assert.match(customerMessage({}, order, 'received').text, /1 × Suya/);
  assert.equal(customerMessage({}, order, 'nothing'), null);
  assert.equal(customerMessage({}, { ...order, payment_status: 'pending' }, 'rejected').text.includes('refunded'), false);
  assert.match(staffMessage(FOOD_DEFAULTS, order, 'CANCELLED'), /MatchDay Kitchen/);
  assert.doesNotMatch(FOOD_DEFAULTS.msgCancelled, /Lobi Stars/, 'no club name in the wording');
});

test('customer WhatsApp: off until Meta is connected, and never for a rejection', async () => {
  const sent = [], logged = [];
  const log = async (c, ok) => { logged.push([c, ok]); };
  globalThis.fetch = async (url, init) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); };
  assert.equal(whatsappConnected({}), false);
  await customerUpdate({ DB: {} }, { ...order, email: '' }, 'accepted', log);
  assert.equal(sent.length, 0, 'not connected: nothing goes out');
  const env = { DB: {}, WHATSAPP_CLOUD_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '99' };
  await customerUpdate(env, { ...order, email: '' }, 'accepted', log);
  assert.equal(sent.length, 1); assert.match(sent[0].url, /\/99\/messages$/); assert.equal(sent[0].body.to, '2348031234567');
  assert.deepEqual(logged.at(-1), ['whatsapp', true]);
  await customerUpdate(env, { ...order, email: '' }, 'rejected', log);
  assert.equal(sent.length, 1, 'a rejection never goes on WhatsApp');
  globalThis.fetch = async () => new Response('{}', { status: 500 });
  await customerUpdate(env, { ...order, email: '' }, 'out', log);
  assert.deepEqual(logged.at(-1), ['whatsapp', false], 'a failure is logged, and doesn\'t throw');
});

test('escalation timers, with the default times', () => {
  const now = Date.parse('2026-11-08T15:00:00Z');
  const ago = m => new Date(now - m * 60000).toISOString();
  const due = (o, sent) => dueEscalations(o, V, now, sent);
  assert.deepEqual(due({ order_status: 'PAID', paid_iso: ago(1) }), []);
  assert.deepEqual(due({ order_status: 'PAID', paid_iso: ago(2) }), ['esc_new']);
  assert.deepEqual(due({ order_status: 'PAID', paid_iso: ago(9) }, ['esc_new']), [], 'once');
  assert.deepEqual(due({ order_status: 'AWAITING_WHATSAPP', created_iso: ago(3) }), ['esc_new']);
  assert.deepEqual(due({ order_status: 'CONFIRMED', created_iso: ago(30) }), [], 'waiting for the fan, not for us');
  assert.deepEqual(due({ order_status: 'PREPARING', preparing_at: ago(14) }), []);
  assert.deepEqual(due({ order_status: 'PREPARING', preparing_at: ago(15) }), ['esc_preparing']);
  assert.deepEqual(due({ order_status: 'READY', ready_at: ago(2) }), []);
  assert.deepEqual(due({ order_status: 'READY', ready_at: ago(3) }), ['esc_ready']);
  assert.deepEqual(due({ order_status: 'READY', ready_at: ago(9), fulfilment: 'pickup' }), [], 'nobody claims a pickup order');
  assert.deepEqual(due({ order_status: 'OUT_FOR_DELIVERY', out_at: ago(9) }), []);
  assert.deepEqual(due({ order_status: 'OUT_FOR_DELIVERY', out_at: ago(10) }), ['esc_out']);
  assert.deepEqual(due({ order_status: 'DELIVERED', out_at: ago(90) }), []);
  // Each venue can have its own times.
  assert.deepEqual(dueEscalations({ order_status: 'PAID', paid_iso: ago(2) }, { ...V, newMinutes: 5 }, now), []);
});

test('kick-off and half-time orders wait, then are released', () => {
  const now = Date.parse('2026-11-08T15:00:00Z');
  const at = m => new Date(now + m * 60000).toISOString();
  const o = { order_status: 'ACCEPTED', accepted_iso: at(-5), deliver_at: at(60) };
  assert.equal(preorderHeld(o, V, now), true);
  assert.deepEqual(dueEscalations(o, V, now), []);
  const soon = { ...o, deliver_at: at(30) };
  assert.equal(preorderHeld(soon, V, now), false);
  assert.deepEqual(dueEscalations(soon, V, now), ['release']);
  assert.deepEqual(dueEscalations(soon, V, now, ['release']), [], 'once');
  assert.deepEqual(dueEscalations({ order_status: 'ACCEPTED', accepted_iso: at(-5), deliver_at: at(5) }, V, now), [], 'never held back: the cooks already know');
  assert.equal(preorderHeld({ order_status: 'ACCEPTED' }, V, now), false, 'an order for now');
});

test('on duty and at this venue', () => {
  const people = [{ endpoint: 'a', role: SUP, staffId: 'S1', venueId: 'v1' }, { endpoint: 'b', role: SUP, staffId: 'S2', venueId: 'v1' }, { endpoint: 'c', role: SUP, staffId: 'S3', venueId: 'v2' }, { endpoint: 'd', role: COOK, staffId: 'C1', venueId: 'v1' }, { endpoint: 'e', role: SA, staffId: 'A1' }];
  const to = (ev, o) => recipientsFor(ev, people, o).map(d => d.endpoint).sort();
  assert.deepEqual(to('ORDER_NEW', { venueId: 'v1' }), ['a', 'b', 'e'], 'no shift running: everyone in the role at this venue');
  assert.deepEqual(to('ORDER_NEW', { venueId: 'v1', duty: ['S1'] }), ['a', 'e'], 'shift running: only those clocked in');
  assert.deepEqual(to('ORDER_ACCEPTED', { venueId: 'v1', duty: ['S1'] }), ['a', 'e'], 'a cook not clocked in hears nothing');
  assert.deepEqual(to('ORDER_ACCEPTED', { venueId: 'v1', duty: ['C1'] }), ['d', 'e']);
  assert.deepEqual(to('ORDER_NEW', { venueId: 'v1', duty: [], levels: { A1: 'off' } }), ['e'], 'nobody on duty and muted: the Super Admin hears it anyway');
  assert.deepEqual(to('ESCALATION_NEW', { venueId: 'v2' }), ['c', 'e']);
  assert.deepEqual(to('ESCALATION_READY', { venueId: 'v1' }), ['a', 'b']);
});

test('refund limit and venue settings', () => {
  assert.equal(refundProblem(100, { refundApprovalKobo: 100 }, false), null);
  assert.match(refundProblem(101, { refundApprovalKobo: 100 }, false), /Super Admin/);
  assert.equal(refundProblem(101, { refundApprovalKobo: 100 }, true), null);
  assert.deepEqual(cleanVenuePatch({ maxOpenOrders: '40', paused: true, pauseMessage: ' Back   soon ' }).patch, { maxOpenOrders: 40, paused: true, pauseMessage: 'Back soon' });
  assert.ok(cleanVenuePatch({ maxOpenOrders: -1 }).error);
  assert.deepEqual(cleanVenuePatch({ newMinutes: 1, refundApprovalNaira: 5000, requireDeliveryCode: false }).patch, {}, 'a supervisor can\'t change these');
  assert.deepEqual(cleanVenuePatch({ newMinutes: 1, refundApprovalNaira: 5000, requireDeliveryCode: false }, { superAdmin: true }).patch, { newMinutes: 1, requireDeliveryCode: false, refundApprovalKobo: 500000 });
  assert.ok(cleanVenuePatch({ newMinutes: 0 }, { superAdmin: true }).error);
});
