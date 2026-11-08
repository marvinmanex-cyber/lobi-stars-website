// Man of the Match: the voting window (kick-off to the 85th minute) and players on the field. No server needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { votingWindow, playersOnField } from '../functions/api/_lib/motm.js';
import { nextSecondHalfAt } from '../functions/api/_lib/matchCentre.js';

const KO = Date.parse('2026-11-08T15:00:00Z'), min = 60e3;
const m = (x = {}) => ({ event_date: '2026-11-08T15:00:00Z', status: 'scheduled', ...x });

test('opens at the scheduled kick-off by itself, or at Start Match if earlier', () => {
  assert.equal(votingWindow(m(), KO - min).state, 'before');
  assert.equal(votingWindow(m(), KO).state, 'open', 'nobody pressed Start Match: still opens at 4pm');
  const early = new Date(KO - 5 * min).toISOString();
  assert.equal(votingWindow(m({ status: 'live', kickoff_at: early }), KO - 4 * min).state, 'open');
  assert.equal(votingWindow(m({ status: 'live', kickoff_at: early })).opensAt, early);
});

test('closes at the 85th minute', () => {
  // No second half recorded: 85 minutes + 15 of half-time after kick-off.
  const late = new Date(KO + 10 * min).toISOString(); // kick-off delayed 10 minutes
  assert.equal(votingWindow(m({ status: 'live', kickoff_at: late }), KO + 109 * min).state, 'open');
  assert.equal(votingWindow(m({ status: 'live', kickoff_at: late }), KO + 110 * min).state, 'closed');
  // Second half recorded: 40 minutes into it.
  const sh = new Date(KO + 62 * min).toISOString();
  const w = x => votingWindow(m({ status: 'live', kickoff_at: new Date(KO).toISOString(), second_half_at: sh }), x);
  assert.equal(w(KO + 101 * min).state, 'open');
  const c = w(KO + 102 * min);
  assert.equal(c.state, 'closed'); assert.equal(c.revealed, false, 'result hidden for the stadium announcement');
  assert.equal(w(KO + 107 * min).revealed, true, '5 minutes later the result shows');
  // Never closes during half-time, and full time always closes and reveals.
  assert.equal(votingWindow(m({ status: 'half-time', kickoff_at: new Date(KO).toISOString() }), KO + 200 * min).state, 'open');
  assert.deepEqual([votingWindow(m({ status: 'full-time' }), KO + 50 * min).state, votingWindow(m({ status: 'full-time' })).revealed], ['closed', true]);
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
