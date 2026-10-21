// Score verification, Phase 4, without a server: the consensus rule and the
// table rule (only confirmed, verified or official results count).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../functions/api/_lib/scores/consensus.js';
import { isCounted } from '../functions/api/_lib/league/standings.js';

const at = m => new Date(Date.UTC(2026, 10, 8, 15, 0) + m * 60e3).toISOString();
const r = (src, hg, ag, status, min, extra = {}) => ({ id: `${src}${min}`, source_type: src, source_identity: src, source_label: src, home_goals: hg, away_goals: ag, status, received_at: at(min), ...extra });

test('two sources agree → confirmed; one source → unconfirmed; none → none', () => {
  assert.equal(decide([]).state, 'NONE');
  const one = decide([r('STAFF_MANUAL', 2, 1, 'FULL_TIME', 110)]);
  assert.equal(one.state, 'UNCONFIRMED');
  assert.equal(one.result.home_goals, 2);
  const two = decide([r('STAFF_MANUAL', 2, 1, 'FULL_TIME', 110), r('CLUB_NETWORK', 2, 1, 'FULL_TIME', 112)]);
  assert.equal(two.state, 'CONFIRMED');
  assert.deepEqual([two.result.home_goals, two.result.away_goals, two.result.status], [2, 1, 'FULL_TIME']);
});

test('different scores disagree; different final results disagree', () => {
  assert.equal(decide([r('STAFF_MANUAL', 2, 1, 'FULL_TIME', 110), r('CLUB_NETWORK', 1, 1, 'FULL_TIME', 111)]).state, 'DISAGREE');
  assert.equal(decide([r('STAFF_MANUAL', 1, 0, 'LIVE', 40), r('CLUB_NETWORK', 0, 0, 'LIVE', 41)]).state, 'DISAGREE');
});

test('live play: a source that has not caught up yet is not a disagreement', () => {
  const d = decide([r('STAFF_MANUAL', 1, 0, 'LIVE', 40), r('CLUB_NETWORK', 1, 0, 'LIVE', 41), r('COMMENTARY_ASSIST', 0, 0, 'LIVE', 30)]);
  assert.equal(d.state, 'CONFIRMED');
  assert.equal(d.result.home_goals, 1);
  assert.match(d.note, /not updated yet/);
  // ...but a NEWER report with another score is.
  assert.equal(decide([r('STAFF_MANUAL', 1, 0, 'LIVE', 40), r('CLUB_NETWORK', 1, 0, 'LIVE', 41), r('COMMENTARY_ASSIST', 1, 1, 'LIVE', 45)]).state, 'DISAGREE');
});

test('half-time and live with the same score agree on the score', () => {
  const d = decide([r('STAFF_MANUAL', 1, 1, 'HALF_TIME', 47), r('CLUB_NETWORK', 1, 1, 'LIVE', 46)]);
  assert.equal(d.state, 'CONFIRMED');
  assert.equal(d.result.status, 'HALF_TIME', 'the newest status');
});

test('one source says full time, another the same score in play: score confirmed, full time not yet', () => {
  const d = decide([r('STAFF_MANUAL', 2, 1, 'FULL_TIME', 108), r('CLUB_NETWORK', 2, 1, 'LIVE', 100)]);
  assert.equal(d.state, 'CONFIRMED');
  assert.equal(d.result.status, 'LIVE');
  assert.equal(decide([r('STAFF_MANUAL', 2, 1, 'FULL_TIME', 108), r('CLUB_NETWORK', 2, 2, 'LIVE', 110)]).state, 'DISAGREE', 'a newer in-play report with another score');
});

test('postponed and abandoned need two sources like any result', () => {
  assert.equal(decide([r('STAFF_MANUAL', null, null, 'POSTPONED', 0)]).state, 'UNCONFIRMED');
  assert.equal(decide([r('STAFF_MANUAL', null, null, 'POSTPONED', 0), r('OFFICIAL_NNL', null, null, 'POSTPONED', 5)]).state, 'CONFIRMED');
  assert.equal(decide([r('STAFF_MANUAL', 1, 0, 'ABANDONED', 70), r('CLUB_NETWORK', 1, 0, 'ABANDONED', 72)]).result.status, 'ABANDONED');
});

test('the table counts only confirmed, verified or official results (older results without a state still count)', () => {
  const f = { home_goals: 2, away_goals: 1, status: 'full_time' };
  assert.equal(isCounted(f), true, 'from before score verification');
  for (const v of ['CONFIRMED', 'VERIFIED', 'OFFICIAL']) assert.equal(isCounted({ ...f, verification: v }), true, v);
  for (const v of ['UNCONFIRMED', 'CONFLICT', 'PENDING']) assert.equal(isCounted({ ...f, verification: v }), false, v);
  assert.equal(isCounted({ ...f, status: 'live', verification: 'CONFIRMED' }, { include_live: 1 }), true, 'live table: confirmed live score');
  assert.equal(isCounted({ ...f, status: 'live', verification: 'UNCONFIRMED' }, { include_live: 1 }), false);
});
