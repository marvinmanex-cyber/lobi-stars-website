// Man of the Match: the voting window (kick-off to the 85th minute) and players on the field. No server needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { votingWindow, playersOnField } from '../functions/api/_lib/motm.js';
import { nextSecondHalfAt } from '../functions/api/_lib/matchCentre.js';

const KO = Date.parse('2026-11-08T15:00:00Z'), min = 60e3;
const m = (x = {}) => ({ event_date: '2026-11-08T15:00:00Z', status: 'scheduled', ...x });

test('fixed times: opens at kick-off, closes 1 hour 50 minutes later, whatever is pressed', () => {
  assert.equal(votingWindow(m(), KO - min).state, 'before');
  assert.equal(votingWindow(m({ status: 'live', kickoff_at: new Date(KO - 10 * min).toISOString() }), KO - min).state, 'before', 'Start Match early does not open it');
  assert.equal(votingWindow(m(), KO).state, 'open', '4:00pm with nobody pressing anything');
  assert.equal(votingWindow(m({ status: 'full-time' }), KO + 100 * min).state, 'open', 'full time pressed early does not close it');
  assert.equal(votingWindow(m({ status: 'live', second_half_at: new Date(KO + 70 * min).toISOString() }), KO + 109 * min).state, 'open');
  const c = votingWindow(m({ status: 'live' }), KO + 110 * min);
  assert.equal(c.state, 'closed'); assert.equal(c.closesAt, '2026-11-08T16:50:00.000Z', '5:50pm Nigerian time'); assert.equal(c.revealed, false);
  assert.equal(votingWindow(m(), KO + 115 * min).revealed, true, 'result shows 5 minutes later');
  assert.equal(votingWindow(m({ status: 'postponed' }), KO).state, 'off');
});

test('the second-half start is remembered when half-time goes back to live', () => {
  assert.equal(nextSecondHalfAt({ status: 'half-time' }, 'live', 'T'), 'T');
  assert.equal(nextSecondHalfAt({ status: 'live', second_half_at: 'S' }, 'live', 'T'), 'S');
  assert.equal(nextSecondHalfAt({ status: 'live' }, 'live', 'T'), null);
  assert.equal(nextSecondHalfAt({ status: 'live', second_half_at: 'S' }, 'scheduled', 'T'), null);
});

test('only players on the field: the starting XI and substitutes who came on', () => {
  const squad = { starting: [{ slug: 'a', name: 'Daniel Atsaka', number: 1 }], bench: [{ slug: 'b', name: 'Musa Sudes', number: 20 }, { slug: 'c', name: 'Victor Amos', number: 19 }, { slug: 'd', name: 'Edwin Oladele', number: 40 }] };
  assert.deepEqual(playersOnField(squad, []).map(p => p.slug), ['a']);
  const tl = [
    { type: 'sub', team: 'home', player: 'Musa Sudes', detail: 'on for Atsaka' },
    { type: 'sub', team: 'away', player: 'Victor Amos', detail: '' },          // the other team: doesn't count
    { type: 'goal', team: 'home', player: 'Edwin Oladele' },                  // not a substitution
    { type: 'sub', team: '', player: '#40 on for #9', detail: '' },          // by shirt number
  ];
  const on = playersOnField(squad, tl, 'home');
  assert.deepEqual(on.map(p => [p.slug, p.role]), [['a', 'Starting XI'], ['b', 'Came on'], ['d', 'Came on']]);
  assert.deepEqual(playersOnField(squad, [{ type: 'sub', team: 'home', player: 'sudes' }]).map(p => p.slug), ['a', 'b'], 'surname alone');
});
