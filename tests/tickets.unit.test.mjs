// Ticket rules without a server: the match list order, ticket states,
// basket prices and checks, the Season Ticket saving, gate states, and the
// homepage cards. node --test tests/tickets.unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upcomingMatches, ticketState, priceBasket, seasonSaving, gateState, naira } from '../functions/api/_lib/tickets/rules.js';
import { upcomingHtml } from '../functions/api/_lib/tickets/upcomingHtml.js';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const day = n => new Date(NOW + n * 864e5).toISOString();
const m = (id, n, extra = {}) => ({ id, home_team: 'Lobi Stars FC', away_team: `Team ${id}`, event_date: day(n), venue: 'McCarthy Stadium', status: 'scheduled', is_home: true, vip_price_kobo: 500000, premium_price_kobo: 200000, regular_price_kobo: 100000, ...extra });

test('match list: kick-off order (Matchday 1 first), live first, finished/cancelled/abandoned out, postponed kept in place', () => {
  const list = [m('c', 21), m('a', 7), m('done', 3, { status: 'full-time' }), m('x', 5, { status: 'cancelled' }), m('ab', 6, { status: 'abandoned' }),
    m('p', 14, { status: 'postponed' }), m('live', -0.05, { status: 'live' }), m('b', 10)];
  assert.deepEqual(upcomingMatches(list, NOW).map(x => x.id), ['live', 'a', 'b', 'p', 'c']);
  assert.deepEqual(upcomingMatches([m('old', -2)], NOW), [], 'a past match that never finished is not "upcoming"');
});

test('ticket states: away, off by default, not open yet, on sale, sold out, closed', () => {
  assert.equal(ticketState(m('a', 7, { is_home: false }), { is_on_sale: 1 }).state, 'away');
  assert.equal(ticketState(m('a', 7), null, {}, NOW).state, 'not_on_sale', 'nothing sold until switched on');
  assert.equal(ticketState(m('a', 7), { is_on_sale: 0 }, {}, NOW).state, 'not_on_sale');
  const opens = ticketState(m('a', 7), { is_on_sale: 1, sale_opens_at: day(2) }, {}, NOW);
  assert.equal(opens.state, 'not_on_sale'); assert.equal(opens.opensAt, day(2));
  assert.equal(ticketState(m('a', 7), { is_on_sale: 1 }, {}, NOW).state, 'on_sale');
  assert.equal(ticketState(m('a', 7, { vip_price_kobo: 0, premium_price_kobo: 0, regular_price_kobo: 0 }), { is_on_sale: 1 }, {}, NOW).state, 'not_on_sale', 'no prices');
  const caps = { is_on_sale: 1, vip_capacity: 10, premium_capacity: 5, regular_capacity: 2 };
  const some = ticketState(m('a', 7), caps, { VIP: 10, Premium: 3 }, NOW);
  assert.equal(some.state, 'on_sale');
  assert.deepEqual(some.tiers.map(t => [t.tier, t.remaining]), [['VIP', 0], ['Premium', 2], ['Regular', 2]]);
  assert.equal(ticketState(m('a', 7), caps, { VIP: 10, Premium: 5, Regular: 2 }, NOW).state, 'sold_out');
  assert.equal(ticketState(m('a', 7), { ...caps, sale_closes_at: day(-1) }, {}, NOW).state, 'closed');
  assert.equal(ticketState(m('a', -1), { is_on_sale: 1 }, {}, NOW).state, 'closed', 'played');
  assert.equal(ticketState(m('a', 7, { status: 'postponed' }), { is_on_sale: 1 }, {}, NOW).state, 'closed');
});

test('basket: prices from the server, limits, sold-out stands, away and off matches refused', () => {
  const cat = new Map([
    ['a', { event: m('a', 7), ticket: ticketState(m('a', 7), { is_on_sale: 1, max_per_order: 4, regular_capacity: 3 }, { Regular: 1 }, NOW) }],
    ['b', { event: m('b', 14), ticket: ticketState(m('b', 14), { is_on_sale: 1 }, {}, NOW) }],
    ['away', { event: m('away', 10, { is_home: false }), ticket: ticketState(m('away', 10, { is_home: false }), { is_on_sale: 1 }, {}, NOW) }],
    ['off', { event: m('off', 21), ticket: ticketState(m('off', 21), { is_on_sale: 0 }, {}, NOW) }],
  ]);
  const ok = priceBasket([{ eventId: 'a', tier: 'VIP', quantity: 2 }, { eventId: 'b', tier: 'Regular', quantity: 3 }], cat);
  assert.equal(ok.ok, true);
  assert.equal(ok.totalKobo, 2 * 500000 + 3 * 100000);
  assert.equal(naira(ok.totalKobo), '₦13,000');
  assert.match(priceBasket([{ eventId: 'a', tier: 'Regular', quantity: 3 }], cat).error, /Only 2 Popular Stand tickets left/);
  assert.equal(priceBasket([{ eventId: 'a', tier: 'Regular', quantity: 3 }], cat).soldOut, true);
  assert.match(priceBasket([{ eventId: 'a', tier: 'VIP', quantity: 5 }], cat).error, /1 to 4 tickets/);
  assert.match(priceBasket([{ eventId: 'away', tier: 'VIP', quantity: 1 }], cat).error, /away match/);
  assert.match(priceBasket([{ eventId: 'off', tier: 'VIP', quantity: 1 }], cat).error, /not on sale/);
  assert.match(priceBasket([{ eventId: 'a', tier: 'VIP', quantity: 1 }, { eventId: 'a', tier: 'VIP', quantity: 1 }], cat).error, /only be added once/);
  assert.equal(priceBasket([], cat).ok, false);
});

test('Season Ticket saving: only when every remaining home match is ticked, one stand, same number', () => {
  const season = { enabled: true, tiers: [{ tier: 'Regular', priceKobo: 500000 }, { tier: 'VIP', priceKobo: 3000000 }] };
  const lines = ids => ids.map(id => ({ eventId: id, tier: 'Regular', quantity: 2, unitKobo: 100000 }));
  const all = ['1', '2', '3', '4', '5', '6', '7'];
  const s = seasonSaving(lines(all), all, season);
  assert.deepEqual([s.matchTotalKobo, s.seasonTotalKobo, s.savingKobo], [1400000, 1000000, 400000]);
  assert.equal(seasonSaving(lines(all.slice(0, 6)), all, season), null, 'not every match');
  assert.equal(seasonSaving([...lines(all.slice(0, 6)), { eventId: '7', tier: 'VIP', quantity: 2, unitKobo: 500000 }], all, season), null, 'mixed stands');
  assert.equal(seasonSaving(lines(all), all, { ...season, enabled: false }), null);
  assert.equal(seasonSaving(lines(['1']), ['1'], season), null, 'no saving when matches cost less');
});

test('gate states: valid, used, wrong match, cancelled', () => {
  const ev = { event_date: '2026-11-08T15:00:00Z' };
  const matchDay = Date.parse('2026-11-08T13:00:00Z');
  assert.equal(gateState({ status: 'valid' }, ev, matchDay), 'valid');
  assert.equal(gateState({ status: 'used' }, ev, matchDay), 'used');
  assert.equal(gateState({ status: 'void' }, ev, matchDay), 'void');
  assert.equal(gateState({ status: 'valid' }, ev, Date.parse('2026-11-15T13:00:00Z')), 'wrong_match');
  assert.equal(gateState(null, ev, matchDay), 'not_found');
});

test('homepage cards: next match big with a countdown, 3 in all, HOME/AWAY and ticket states, escaped', () => {
  const list = [
    { ...m('h1', 7), slug: 'h1', matchday: 1, competition: 'NNL Conference D', ticket: { state: 'on_sale', fromKobo: 100000 } },
    { ...m('a1', 14, { home_team: 'Kada Warriors FC', away_team: 'Lobi Stars FC', is_home: false }), slug: 'a1', matchday: 2 },
    { ...m('h2', 21), slug: 'h2', matchday: 3, ticket: { state: 'sold_out' } },
    { ...m('h3', 28), slug: 'h3', matchday: 4, ticket: { state: 'not_on_sale' } },
    { ...m('p', 10, { status: 'postponed', away_team: '<b>Bad</b> FC' }), slug: 'p', matchday: 5 },
  ];
  const html = upcomingHtml(list, { now: NOW });
  assert.equal((html.match(/<li class="nm-card/g) || []).length, 3);
  assert.equal((html.match(/nm-card--next/g) || []).length, 1);
  assert.match(html, /data-countdown=/);
  assert.match(html, /Matchday 1/);
  assert.match(html, /Buy ticket <small>from ₦1,000<\/small>/);
  assert.match(html, /Away fixture/);
  assert.match(html, /Postponed – date to be confirmed/);
  assert.ok(!html.includes('<b>Bad</b>'), 'names are escaped');
  assert.match(html, /"@type":"SportsEvent"/);
  assert.match(upcomingHtml([{ ...m('h2', 7), ticket: { state: 'sold_out' } }], { now: NOW }), /Sold out/);
  assert.match(upcomingHtml([{ ...m('h3', 7), ticket: { state: 'not_on_sale' } }], { now: NOW }), /Tickets not on sale yet/);
  assert.match(upcomingHtml([], { now: NOW }), /announced soon/);
});
