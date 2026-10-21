// Score verification, Phase 3, without a server: the rules that read score
// messages in the usual formats, and when a message is "not sure".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, parseByRules, MIN_CONFIDENCE } from '../functions/api/_lib/scores/extract.js';

const TEAMS = [
  { id: 1, code: 'KAD', name: 'Kada Warriors FC', short_name: 'Kada Warriors', aliases: '[]' },
  { id: 2, code: 'WIK', name: 'Wikki Tourists FC', short_name: 'Wikki Tourists', aliases: '["Wikki"]' },
  { id: 3, code: 'ABS', name: 'ABS FC', short_name: 'ABS', aliases: '[]' },
  { id: 4, code: 'SOK', name: 'Sokoto United FC', short_name: 'Sokoto Utd', aliases: '["Sokoto United"]' },
];
const one = (text) => { const r = parseByRules(text, TEAMS); assert.equal(r.matches.length, 1, text); return r.matches[0]; };

test('the usual formats', () => {
  const cases = [
    ['FT: Kada Warriors 2-1 Wikki Tourists', ['Kada Warriors', 'Wikki Tourists', 2, 1, 'FULL_TIME']],
    ['Kada Warriors 2 - 1 Wikki FT', ['Kada Warriors', 'Wikki', 2, 1, 'FULL_TIME']],
    ['*HT* ABS 0:0 Sokoto United', ['ABS', 'Sokoto United', 0, 0, 'HALF_TIME']],
    ['Kada Warriors vs Wikki Tourists 1-1 (full time)', ['Kada Warriors', 'Wikki Tourists', 1, 1, 'FULL_TIME']],
    ['ABS 3, Sokoto Utd 2 FT', ['ABS', 'Sokoto Utd', 3, 2, 'FULL_TIME']],
    ["⚽ Kada Warriors 1-0 Wikki 67'", ['Kada Warriors', 'Wikki', 1, 0, 'LIVE']],
    ['Result: ABS 1-2 Kada Warriors. Final score', ['ABS', 'Kada Warriors', 1, 2, 'FULL_TIME']],
    ['Wikki v ABS postponed', ['Wikki', 'ABS', null, null, 'POSTPONED']],
    ['Kada Warriors 0-0 ABS abandoned', ['Kada Warriors', 'ABS', 0, 0, 'ABANDONED']],
  ];
  for (const [text, [h, a, hg, ag, st]] of cases) {
    const m = one(text);
    assert.deepEqual([m.home, m.away, m.homeGoals, m.awayGoals, m.status], [h, a, hg, ag, st], text);
    assert.ok(m.confidence >= MIN_CONFIDENCE, `${text} is sure`);
  }
  assert.equal(parseLine("Kada Warriors 1-0 Wikki 90+3'").minute, '90+3');
});

test('a status heading applies to the lines under it; several matches in one message', () => {
  const r = parseByRules('Full time results\nFT\nKada Warriors 2-1 Wikki\nABS 0-0 Sokoto United\n\nThanks', TEAMS);
  assert.equal(r.matches.length, 2);
  assert.ok(r.matches.every(m => m.status === 'FULL_TIME' && m.confidence >= MIN_CONFIDENCE));
});

test('not sure → needs review: no status written, or a team nobody knows', () => {
  const noStatus = one('Kada Warriors 2-1 Wikki');
  assert.ok(noStatus.confidence < MIN_CONFIDENCE);
  assert.match(noStatus.notes, /no status/);
  const unknown = one('FT Kano Pillars 1-0 Wikki');
  assert.ok(unknown.confidence < MIN_CONFIDENCE);
  assert.match(unknown.notes, /Kano Pillars/);
});

test('lines without a score are not guessed', () => {
  const r = parseByRules('Good afternoon sir\nThe match is about to start\nWe are winning!', TEAMS);
  assert.equal(r.matches.length, 0);
  assert.equal(parseLine('Kick off at 4pm'), null);
  assert.equal(parseLine('2-1'), null);
});
