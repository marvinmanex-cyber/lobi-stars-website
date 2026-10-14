// Lobi Stars Rewards: pure earning rules (functions/api/_lib/rewardsRules.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { purchasePoints, lagosMonthStartUtc, capAllowance, streakReached, selfReferralReason, birthdayDue, settingsProblem } from '../functions/api/_lib/rewardsRules.js';
import { REWARDS_DEFAULTS } from '../functions/api/_lib/rewards.js';

test('purchase points: per ₦100 actually paid, rounded down; multiplier rounded down', () => {
  assert.equal(purchasePoints(2000000, 1), 200, '₦20,000 -> 200');
  assert.equal(purchasePoints(19999, 1), 1, '₦199.99 -> 1');
  assert.equal(purchasePoints(9999, 1), 0);
  assert.equal(purchasePoints(150000, 2), 30, '2 points per ₦100');
  assert.equal(purchasePoints(150000, 1, 1.25), 18, '15 x 1.25 = 18.75 -> 18');
  assert.equal(purchasePoints(-500, 1), 0);
});

test('Nigerian calendar month start (UTC+1)', () => {
  assert.equal(lagosMonthStartUtc(Date.parse('2026-10-14T12:00:00Z')), '2026-09-30 23:00:00');
  assert.equal(lagosMonthStartUtc(Date.parse('2026-10-31T23:30:00Z')), '2026-10-31 23:00:00', '00:30 on 1 Nov in Lagos is already November');
});

test('monthly cap for votes and predictions', () => {
  assert.equal(capAllowance(5, 190, 200), 5);
  assert.equal(capAllowance(30, 190, 200), 10, 'only what is left this month');
  assert.equal(capAllowance(5, 200, 200), 0);
  assert.equal(capAllowance(30, 500, 0), 30, '0 = no cap');
});

test('home matches in a row: needs the last N attended, no overlap with an earlier bonus', () => {
  const home = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
  assert.equal(streakReached(home.slice(0, 3), new Set(['m1', 'm2', 'm3']), new Set(), 3), true);
  assert.equal(streakReached(home.slice(0, 3), new Set(['m1', 'm3']), new Set(), 3), false, 'missed one');
  assert.equal(streakReached(home.slice(0, 4), new Set(['m1', 'm2', 'm3', 'm4']), new Set(['m3']), 3), false, 'm2-m4 overlaps the bonus at m3');
  assert.equal(streakReached(home.slice(0, 6), new Set(home), new Set(['m3']), 3), true, 'm4-m6 is a new streak');
  assert.equal(streakReached(['m1', 'm2'], new Set(['m1', 'm2']), new Set(), 3), false, 'not enough matches yet');
});

test('self-referral checks', () => {
  const a = { id: 'A', email: 'terna@benuetech.ng', surname: 'Akaa', phone: '+2348031111111', device: 'dev-1' };
  assert.equal(selfReferralReason(a, { id: 'B', email: 'ade@gmail.com', surname: 'Ade', phone: '+2348032222222', device: 'dev-2' }), null);
  assert.equal(selfReferralReason(a, { id: 'B', email: 'x@gmail.com', surname: 'X', device: 'dev-1' }), 'same device');
  assert.equal(selfReferralReason(a, { id: 'B', email: 'mary@benuetech.ng', surname: 'akaa' }), 'same surname and email domain');
  assert.equal(selfReferralReason({ ...a, email: 'a@gmail.com' }, { id: 'B', email: 'b@gmail.com', surname: 'Akaa' }), null, 'shared free email domains are fine');
  assert.equal(selfReferralReason({ ...a, email: 'terna.akaa1@gmail.com' }, { id: 'B', email: 'terna.akaa2@gmail.com', surname: 'Other' }), 'same email name pattern');
  assert.equal(selfReferralReason(a, { ...a }), 'same account');
});

test('birthday bonus: in the birthday month, date of birth saved 30+ days before', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  assert.equal(birthdayDue('1995-10-02', '2026-08-01T00:00:00Z', 30, now), true);
  assert.equal(birthdayDue('1995-10-02', '2026-10-01T00:00:00Z', 30, now), false, 'saved only 13 days ago');
  assert.equal(birthdayDue('1995-11-02', '2026-01-01T00:00:00Z', 30, now), false, 'not their month');
  assert.equal(birthdayDue('', '2026-01-01T00:00:00Z', 30, now), false);
});

test('defaults are valid settings; bad values are refused', () => {
  assert.equal(settingsProblem(REWARDS_DEFAULTS), null);
  assert.match(settingsProblem({ ...REWARDS_DEFAULTS, attendance: -1 }), /attendance/);
  assert.match(settingsProblem({ ...REWARDS_DEFAULTS, ticketsPer100: 500 }), /ticketsPer100/);
  assert.match(settingsProblem({ ...REWARDS_DEFAULTS, streakLength: 1 }), /in a row/);
});

import { tierFor, effectiveTier, tiersProblem, tierBenefits, seasonLabel } from '../functions/api/_lib/rewardsRules.js';
const TIERS = REWARDS_DEFAULTS.tiers;

test('tiers by points earned this season', () => {
  assert.equal(tierFor(0, TIERS).key, 'red');
  assert.equal(tierFor(999, TIERS).key, 'red');
  assert.equal(tierFor(1000, TIERS).key, 'gold');
  assert.equal(tierFor(2999, TIERS).key, 'gold');
  assert.equal(tierFor(3000, TIERS).key, 'star');
  const e = effectiveTier({ earned: 350, seasonStart: '2026-08-01' }, TIERS);
  assert.equal(e.tier.key, 'red'); assert.equal(e.next.key, 'gold'); assert.equal(e.toNext, 650, '650 more points this season to reach Gold');
  assert.equal(seasonLabel('2026-08-01'), '2026/27');
});

test('paid members at least Gold; last season\'s tier kept during the grace period', () => {
  assert.equal(effectiveTier({ earned: 10, paidMember: true, seasonStart: '2026-08-01' }, TIERS).tier.key, 'gold');
  assert.equal(effectiveTier({ earned: 10, paidMember: true, paidMembersStartGold: false, seasonStart: '2026-08-01' }, TIERS).tier.key, 'red');
  assert.equal(effectiveTier({ earned: 3500, paidMember: true, seasonStart: '2026-08-01' }, TIERS).tier.key, 'star', 'points can take a member higher');
  const inGrace = effectiveTier({ earned: 0, prevEarned: 3200, seasonStart: '2026-08-01', graceMonths: 2, now: Date.parse('2026-09-15T12:00:00Z') }, TIERS);
  assert.equal(inGrace.tier.key, 'star'); assert.equal(inGrace.reason, 'last-season'); assert.equal(inGrace.graceUntil, '2026-09-30T23:00:00.000Z');
  assert.equal(effectiveTier({ earned: 0, prevEarned: 3200, seasonStart: '2026-08-01', graceMonths: 2, now: Date.parse('2026-10-02T12:00:00Z') }, TIERS).tier.key, 'red', 'grace over');
});

test('tier benefits come from the numbers; tier settings are validated', () => {
  assert.deepEqual(tierBenefits(TIERS[1]).slice(0, 2), ['1.25x Pride Points on purchases', 'Buy match tickets 24 hours before general sale']);
  assert.deepEqual(tierBenefits(TIERS[0]), []);
  assert.equal(tiersProblem(TIERS), null);
  assert.match(tiersProblem([TIERS[0], { ...TIERS[1], min: 5000 }, TIERS[2]]), /more than Gold/);
  assert.match(tiersProblem([TIERS[0], { ...TIERS[1], multiplier: 9 }, TIERS[2]]), /multiplier/);
});
