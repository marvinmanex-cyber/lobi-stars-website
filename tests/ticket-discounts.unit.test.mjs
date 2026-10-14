// Ticket discounts (functions/api/_lib/tickets/discounts.js): the pure
// pricing function used by the price preview, checkout and the webhook.
// Fixed UTC timestamps; money in kobo; percents in basis points.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOrderPricing, publicOffers, ruleProblem, familyProblem } from '../functions/api/_lib/tickets/discounts.js';

const KO = '2026-11-08T15:00:00.000Z'; // kick-off (4:00 PM in Nigeria)
const DAY = 864e5;
const NOW = Date.parse(KO) - 30 * DAY;
const GROUP = { id: 'group', kind: 'group', name: 'Group discount', isActive: true, percentBp: 0, config: {}, maxPerMatch: null, tiers: [{ minTickets: 10, percentBp: 1000 }, { minTickets: 20, percentBp: 1500 }] };
const EARLY = { id: 'early_bird', kind: 'early_bird', name: 'Early bird', isActive: true, percentBp: 1000, config: { daysBefore: 7 }, maxPerMatch: null };
const FAMILY = { id: 'family', kind: 'family', name: 'Family bundle', isActive: true, percentBp: 1500, config: { minAdults: 1, maxAdults: 2, minChildren: 1, maxChildren: 4, childMaxAge: 16 }, maxPerMatch: null };
const line = (q, o = {}) => ({ eventId: 'm1', tier: 'Regular', unitKobo: 100000, kickoff: KO, adults: q, children: 0, family: false, allowDiscounts: true, ...o });
const fam = (a, c, o = {}) => line(a, { family: true, children: c, ...o });
const price = (lines, rules, settings = {}, now = NOW, ctx = {}) => computeOrderPricing(lines, rules, settings, now, ctx);

test('group tiers: 9 none, 10 and 19 tier one, 20 tier two', () => {
  assert.equal(price([line(9)], [GROUP]).discountKobo, 0);
  const t10 = price([line(10)], [GROUP]);
  assert.equal(t10.discountKobo, 10 * 10000); assert.equal(t10.totalKobo, 900000); assert.equal(t10.label, 'Group (10%)');
  assert.equal(price([line(19)], [GROUP]).discountKobo, 19 * 10000);
  const t20 = price([line(20)], [GROUP]);
  assert.equal(t20.discountKobo, 20 * 15000); assert.equal(t20.label, 'Group (15%)');
  // Group counts every stand of the same match together.
  assert.equal(price([line(6), line(4, { tier: 'VIP', unitKobo: 500000 })], [GROUP]).discountKobo, 6 * 10000 + 4 * 50000);
});

test('nudge when close to a group tier', () => {
  assert.equal(price([line(8)], [GROUP]).matches[0].nudge.text, 'Add 2 more tickets to save 10%.');
  assert.equal(price([line(18)], [GROUP]).matches[0].nudge.text, 'Add 2 more tickets to save 15%.');
  assert.equal(price([line(5)], [GROUP]).matches[0].nudge, null, 'not when far off');
  assert.equal(price([line(20)], [GROUP]).matches[0].nudge, null);
});

test('early bird: exactly 7 days before applies; one second later does not; just before applies', () => {
  const edge = Date.parse(KO) - 7 * DAY;
  assert.equal(price([line(1)], [EARLY], {}, edge).discountKobo, 10000, 'exactly at the boundary');
  assert.equal(price([line(1)], [EARLY], {}, edge - 1000).discountKobo, 10000, 'just before (earlier)');
  assert.equal(price([line(1)], [EARLY], {}, edge + 1000).discountKobo, 0, 'just after (too late)');
  const offers = publicOffers([EARLY], {}, { kickoff: KO }, NOW);
  assert.equal(offers.earlyBird.endsAt, new Date(edge).toISOString());
  assert.equal(publicOffers([EARLY], {}, { kickoff: KO }, edge + 1000), null);
});

test('family bundle: valid and invalid compositions; children only in a bundle', () => {
  const ok = price([fam(2, 3)], [FAMILY]);
  assert.equal(ok.ok, true); assert.equal(ok.discountKobo, 5 * 15000);
  assert.equal(ok.matches[0].tickets.filter(t => t.type === 'child').length, 3);
  assert.equal(price([fam(1, 1)], [FAMILY]).discountKobo, 2 * 15000);
  for (const [a, c] of [[0, 2], [3, 1], [1, 0], [2, 5]]) {
    const r = price([fam(a, c)], [FAMILY]);
    assert.equal(r.ok, false, `${a} adults, ${c} children`); assert.match(r.error, /family bundle/i);
  }
  assert.equal(price([line(0, { children: 2 })], [FAMILY]).ok, false, 'child tickets cannot be bought alone');
  assert.equal(price([fam(1, 2)], [GROUP]).ok, false, 'family rule switched off');
  assert.equal(price([fam(1, 2), line(1, { tier: 'VIP' })], [FAMILY]).ok, false, 'a bundle is one stand of one match');
  assert.equal(familyProblem(FAMILY, 2, 4), null);
});

test('best single discount by default; stacking adds up but is capped', () => {
  // 10 tickets, 30 days out: group 10% vs early bird 10% -> one of them, not both.
  const single = price([line(20)], [GROUP, EARLY]);
  assert.equal(single.discountKobo, 20 * 15000, 'group 15% beats early bird 10%');
  assert.equal(single.applied.length, 1); assert.equal(single.applied[0].kind, 'group');
  assert.match(single.matches[0].reason, /not combined/);
  const stack = price([line(20)], [GROUP, EARLY], { allowStacking: true, maxTotalBp: 2000 });
  assert.equal(stack.discountKobo, 20 * 20000, '15% + 10% capped at 20%');
  assert.equal(stack.applied.length, 2); assert.match(stack.matches[0].reason, /capped at 20%/);
  assert.equal(price([line(20)], [GROUP, EARLY], { allowStacking: true, maxTotalBp: 3000 }).discountKobo, 20 * 25000);
});

test('minimum ticket price, rounding down to whole naira, basis points', () => {
  // ₦1,005 at 10% = ₦100.50 -> ₦100 off.
  const r = price([line(1, { unitKobo: 100500 })], [EARLY]);
  assert.equal(r.discountKobo, 10000); assert.equal(r.discountKobo % 100, 0);
  // 12.5% (1250 bp) of ₦999 = ₦124.875 -> ₦124.
  assert.equal(price([line(1, { unitKobo: 99900 })], [{ ...EARLY, percentBp: 1250 }]).discountKobo, 12400);
  // Floor: never below ₦950 -> only ₦50 off a ₦1,000 ticket.
  assert.equal(price([line(1)], [EARLY], { minTicketKobo: 95000 }).matches[0].tickets[0].priceKobo, 95000);
  assert.equal(price([line(1, { unitKobo: 90000 })], [EARLY], { minTicketKobo: 95000 }).discountKobo, 0, 'already below the floor');
});

test('discounted-ticket allowance runs out mid-order', () => {
  const capped = { ...EARLY, maxPerMatch: 50 };
  const r = price([line(5)], [capped], {}, NOW, { m1: { usedByRule: { early_bird: 48 }, usedMatch: 48 } });
  assert.equal(r.discountKobo, 2 * 10000, 'only 2 of 5 discounted');
  assert.equal(r.matches[0].discountedQty, 2); assert.match(r.matches[0].reason, /2 of 5/);
  assert.equal(price([line(5)], [capped], {}, NOW, { m1: { usedByRule: { early_bird: 50 } } }).discountKobo, 0);
  // The per-match cap (all rules together) too.
  assert.equal(price([line(5)], [EARLY], {}, NOW, { m1: { usedMatch: 9, matchCap: 10 } }).discountKobo, 10000);
  assert.equal(publicOffers([capped], {}, { kickoff: KO }, NOW, { usedByRule: { early_bird: 50 } }), null, 'no badge when used up');
});

test('inactive, expired and not-yet-valid rules are ignored; a match can exclude discounts', () => {
  assert.equal(price([line(1)], [{ ...EARLY, isActive: false }]).discountKobo, 0);
  assert.equal(price([line(1)], [{ ...EARLY, validUntil: new Date(NOW - 1000).toISOString() }]).discountKobo, 0);
  assert.equal(price([line(1)], [{ ...EARLY, validFrom: new Date(NOW + 1000).toISOString() }]).discountKobo, 0);
  assert.equal(price([line(1)], [{ ...EARLY, validFrom: new Date(NOW - 1000).toISOString(), validUntil: new Date(NOW + 1000).toISOString() }]).discountKobo, 10000);
  assert.equal(price([line(20, { allowDiscounts: false })], [GROUP, EARLY]).discountKobo, 0);
  assert.equal(publicOffers([GROUP], {}, { kickoff: KO, allowDiscounts: false }, NOW), null);
});

test('several matches in one order are priced per match', () => {
  const r = price([line(10), line(9, { eventId: 'm2', kickoff: new Date(NOW + 2 * DAY).toISOString() })], [GROUP, EARLY]);
  assert.equal(r.matches.length, 2);
  assert.equal(r.matches[0].discountKobo, 10 * 10000, 'm1: group (or early bird) on 10 tickets');
  assert.equal(r.matches[1].discountKobo, 0, 'm2: 9 tickets, and only 2 days before kick-off');
  assert.equal(r.totalKobo, 19 * 100000 - 10 * 10000);
});

test('one group/family discount per email per match (splitting orders does not reuse it)', () => {
  const ctx = { m1: { priorDiscountOrders: 1 } };
  assert.equal(price([line(10)], [GROUP], {}, NOW, ctx).discountKobo, 0);
  assert.equal(price([fam(1, 2)], [FAMILY], {}, NOW, ctx).discountKobo, 0);
  assert.equal(price([line(10)], [GROUP], { perEmailPerMatch: 2 }, NOW, ctx).discountKobo, 100000);
  assert.equal(price([line(1)], [EARLY], {}, NOW, ctx).discountKobo, 10000, 'early bird is not limited per email');
});

test('admin validation: percents, ascending tiers, sane family numbers', () => {
  assert.equal(ruleProblem(GROUP), null); assert.equal(ruleProblem(EARLY), null); assert.equal(ruleProblem(FAMILY), null);
  assert.match(ruleProblem({ ...EARLY, percentBp: 10001 }), /0 and 100/);
  assert.match(ruleProblem({ ...GROUP, tiers: [{ minTickets: 20, percentBp: 1500 }, { minTickets: 10, percentBp: 1000 }] }), /go up/);
  assert.match(ruleProblem({ ...FAMILY, config: { ...FAMILY.config, maxAdults: 0 } }), /adult/);
  assert.match(ruleProblem({ ...EARLY, validFrom: '2026-12-01T00:00:00Z', validUntil: '2026-11-01T00:00:00Z' }), /before the end/);
});
