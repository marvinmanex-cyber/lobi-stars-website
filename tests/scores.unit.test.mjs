// Score verification, Phase 1, without a server: team name matching through
// aliases, the independence rule, and the legal rule (prohibited websites and
// licensed adapters can't run unless the licence is confirmed with a note).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normName, namesOf, findTeamByName, independenceKey, latestPerSource, assertAdapterMayRun, assertAllowedFetch, SOURCE_TYPES, REPORT_STATUSES, PROHIBITED_HOSTS } from '../functions/api/_lib/scores/model.js';

const TEAMS = [
  { id: 1, code: 'MJF', name: 'Mighty Jets Feeder FC', short_name: 'Mighty Jets Feeder', aliases: '["Bida Lions", "Mighty Jets Feeder / Bida Lions"]' },
  { id: 2, code: 'KAD', name: 'Kada Warriors FC', short_name: 'Kada Warriors', aliases: '[]' },
  { id: 3, code: 'WIK', name: 'Wikki Tourists FC', short_name: 'Wikki Tourists', aliases: '["Wikki"]' },
  { id: 4, code: 'ABS', name: 'ABS FC', short_name: 'ABS', aliases: '["Kwara United Feeder"]' },
];

test('team names: case, "FC" and punctuation are ignored; every alias works', () => {
  assert.equal(normName('Kada Warriors F.C.'), 'kada warriors');
  assert.equal(normName('  KADA-warriors fc '), 'kada warriors');
  assert.equal(normName('Mighty Jets Feeder / Bida Lions'), 'mighty jets feeder bida lions');
  for (const n of ['Bida Lions', 'bida lions fc', 'MIGHTY JETS FEEDER', 'Mighty Jets Feeder / Bida Lions', 'mjf']) assert.equal(findTeamByName(TEAMS, n)?.id, 1, n);
  assert.equal(findTeamByName(TEAMS, 'Wikki')?.id, 3);
  assert.equal(findTeamByName(TEAMS, 'ABS F.C')?.id, 4);
  assert.equal(findTeamByName(TEAMS, 'Kano Pillars'), null, 'unknown names are not guessed');
  assert.equal(findTeamByName(TEAMS, ''), null);
  assert.equal(findTeamByName([...TEAMS, { id: 9, code: 'X', name: 'Wikki United', short_name: 'X', aliases: '["Wikki"]' }], 'Wikki'), null, 'a name that fits two teams is not matched');
  assert.ok(namesOf(TEAMS[0]).includes('bida lions'));
});

test('independence: different identities count separately; the same person twice counts once; the API counts once', () => {
  const r = (id, type, identity, at, hg = 1) => ({ id, source_type: type, source_identity: identity, received_at: at, home_goals: hg, away_goals: 0 });
  assert.notEqual(independenceKey(r(1, 'CLUB_NETWORK', 'submitter:4')), independenceKey(r(2, 'CLUB_NETWORK', 'submitter:9')), 'two club submitters = two sources');
  assert.equal(independenceKey(r(1, 'STAFF_MANUAL', 'staff:ada')), independenceKey(r(2, 'STAFF_MANUAL', 'STAFF:ADA')), 'the same staff member twice = one');
  assert.equal(independenceKey(r(1, 'LICENSED_API', 'poll-1')), independenceKey(r(2, 'LICENSED_API', 'poll-2')), 'the licensed API counts once however often it is polled');
  assert.notEqual(independenceKey(r(1, 'STAFF_MANUAL', 'staff:ada')), independenceKey(r(2, 'CLUB_NETWORK', 'staff:ada')), 'different source types are independent');
  const latest = latestPerSource([
    r(1, 'CLUB_NETWORK', 'submitter:4', '2026-11-08T16:30:00Z', 0), r(2, 'CLUB_NETWORK', 'submitter:4', '2026-11-08T17:50:00Z', 2),
    r(3, 'LICENSED_API', 'poll', '2026-11-08T17:40:00Z', 2), r(4, 'LICENSED_API', 'poll', '2026-11-08T17:52:00Z', 2),
    r(5, 'STAFF_MANUAL', 'staff:ada', '2026-11-08T17:55:00Z', 2),
  ]);
  assert.equal(latest.length, 3, 'three independent sources');
  assert.deepEqual(latest.map(x => x.id).sort(), [2, 4, 5], 'the latest report of each');
});

test('legal rule: licensed and prohibited sources can never run without a confirmed licence and a note', () => {
  assert.equal(SOURCE_TYPES.LICENSED_API.enabled, 0, 'licensed API off by default');
  assert.equal(SOURCE_TYPES.FUTURE_LICENSED.enabled, 0, 'placeholder off by default');
  const off = { type: 'FUTURE_LICENSED', enabled: 0, licence_confirmed: 0, licence_note: '' };
  assert.throws(() => assertAdapterMayRun(off), /switched off/);
  assert.throws(() => assertAdapterMayRun({ ...off, enabled: 1 }), /licence \/ permission confirmed/);
  assert.throws(() => assertAdapterMayRun({ ...off, enabled: 1, licence_confirmed: 1, licence_note: 'ok' }), /licence/, 'a confirmation needs a real note');
  const licensed = { ...off, enabled: 1, licence_confirmed: 1, licence_note: 'Written permission from X Ltd, 20 Oct 2026, ref 123' };
  assert.equal(assertAdapterMayRun(licensed), true);
  for (const host of ['www.soccerway.com', 'sofascore.com', 'm.flashscore.com.ng']) {
    assert.throws(() => assertAllowedFetch({ ...licensed, licence_confirmed: 0 }, `https://${host}/x`), /licence|not allow/, host);
  }
  assert.ok(PROHIBITED_HOSTS.includes('soccerway.com'));
  assert.throws(() => assertAllowedFetch(licensed, 'http://api.example.com/'), /https/);
  assert.equal(assertAllowedFetch(licensed, 'https://v3.football.api-sports.io/fixtures'), true);
  assert.throws(() => assertAdapterMayRun({ type: 'STAFF_MANUAL', enabled: 0 }), /switched off/);
});

test('report statuses as specified', () => {
  assert.deepEqual(REPORT_STATUSES, ['SCHEDULED', 'LIVE', 'HALF_TIME', 'FULL_TIME', 'POSTPONED', 'ABANDONED', 'AWARDED', 'CANCELLED']);
});
