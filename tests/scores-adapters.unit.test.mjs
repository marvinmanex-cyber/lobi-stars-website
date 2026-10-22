// Score verification, Phase 6, without a server: the licensed API adapters
// (API-Football, Sportmonks, a licensed JSON feed), the polling timetable and
// the LEGAL RULE: nothing is ever fetched from a prohibited website, a source
// that is off, or a licensed source whose licence isn't confirmed with a note.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { d1 } from './helpers/d1shim.mjs';
import { mapApiFootball, mapSportmonks, runAdapter, pollSources, coverageTest } from '../functions/api/_lib/scores/adapters.js';
import { ensureScoreSchema } from '../functions/api/_lib/scores/model.js';
import { ensureConsensusSchema, SCORE_SETTINGS } from '../functions/api/_lib/scores/consensus.js';

const DB = d1();
const env = { DB, LICENSED_API_KEY: 'k-test', LICENSED_API_LEAGUE_ID: '999', LICENSED_API_SEASON: '2026' };
const settings = Object.fromEntries(Object.entries(SCORE_SETTINGS).map(([k, s]) => [k, s.def]));
const KO = Date.parse('2026-11-08T15:00:00Z');
const licence = (type, on, note = 'Licence agreement LS-2026-01, signed 20 Oct 2026') => DB.prepare(`UPDATE score_sources SET enabled = ?, licence_confirmed = ?, licence_note = ? WHERE type = ?`).bind(on ? 1 : 0, on ? 1 : 0, on ? note : null, type).run();
const fakeFetch = body => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => body }; }; f.calls = calls; return f; };
const apiFootball = (h, a, hg, ag, short) => ({ response: [{ fixture: { id: 1, date: '2026-11-08T15:00:00+00:00', status: { short, elapsed: short === 'FT' ? 90 : 55 } }, teams: { home: { name: h }, away: { name: a } }, goals: { home: hg, away: ag } }] });

let HOME, AWAY, FX;
before(async () => {
  await ensureScoreSchema(env);
  await ensureConsensusSchema(env);
  // The league schema comes with the real clubs and fixtures: use the first non-Lobi match.
  const f = await DB.prepare(`SELECT f.id, h.short_name AS home, a.short_name AS away FROM league_fixtures f JOIN league_teams h ON h.id = f.home_team_id JOIN league_teams a ON a.id = f.away_team_id
    WHERE h.is_lobi = 0 AND a.is_lobi = 0 ORDER BY f.id LIMIT 1`).first();
  [FX, HOME, AWAY] = [f.id, f.home, f.away];
  await DB.prepare(`UPDATE league_fixtures SET kickoff_at = ? WHERE id = ?`).bind(new Date(KO).toISOString(), FX).run();
  await DB.prepare(`UPDATE league_fixtures SET kickoff_at = '2027-05-01T15:00:00Z' WHERE id != ?`).bind(FX).run();
});

test('provider answers are read the same way', () => {
  const a = mapApiFootball(apiFootball(HOME, AWAY, 2, 1, 'FT'));
  assert.deepEqual([a[0].home, a[0].homeGoals, a[0].awayGoals, a[0].status], [HOME, 2, 1, 'FULL_TIME']);
  assert.equal(mapApiFootball(apiFootball('A', 'B', 0, 0, 'HT'))[0].status, 'HALF_TIME');
  assert.equal(mapApiFootball(apiFootball('A', 'B', null, null, 'PST'))[0].status, 'POSTPONED');
  const s = mapSportmonks({ data: [{ id: 5, starting_at: '2026-11-08 15:00:00', state: { developer_name: 'INPLAY_2ND_HALF' },
    participants: [{ name: 'Kada Warriors', meta: { location: 'home' } }, { name: 'Wikki Tourists', meta: { location: 'away' } }],
    scores: [{ description: 'CURRENT', score: { goals: 1, participant: 'home' } }, { description: 'CURRENT', score: { goals: 0, participant: 'away' } }] }] });
  assert.deepEqual([s[0].home, s[0].away, s[0].homeGoals, s[0].awayGoals, s[0].status], ['Kada Warriors', 'Wikki Tourists', 1, 0, 'LIVE']);
});

test('LEGAL RULE: no request is made while the source is off or its licence is not confirmed with a note', async () => {
  const f = fakeFetch(apiFootball(HOME, AWAY, 1, 0, '2H'));
  assert.match((await runAdapter(env, 'LICENSED_API', { now: KO, fetcher: f })).error, /switched off/);
  await DB.prepare(`UPDATE score_sources SET enabled = 1 WHERE type = 'LICENSED_API'`).run();
  assert.match((await runAdapter(env, 'LICENSED_API', { now: KO, fetcher: f })).error, /licence/);
  await licence('LICENSED_API', true, 'ok');
  assert.match((await runAdapter(env, 'LICENSED_API', { now: KO, fetcher: f })).error, /licence/, 'a real note is required');
  assert.equal(f.calls.length, 0, 'nothing was fetched');
});

test('LEGAL RULE: Soccerway, Sofascore, Flashscore… can never be read automatically without a licence', async () => {
  for (const url of ['https://www.soccerway.com/national/nigeria/', 'https://api.sofascore.com/api/v1/event/1', 'https://www.flashscore.com.ng/football/nigeria/', 'http://example.org/feed.json']) {
    const f = fakeFetch({ matches: [] });
    await DB.prepare(`UPDATE score_sources SET enabled = 1, licence_confirmed = 0, licence_note = NULL WHERE type = 'FUTURE_LICENSED'`).run();
    const r = await runAdapter({ ...env, FUTURE_SOURCE_URL: url }, 'FUTURE_LICENSED', { now: KO, fetcher: f });
    assert.equal(r.ok, false, url);
    assert.equal(f.calls.length, 0, `${url}: never fetched`);
  }
  // Even with a licence, plain http is refused.
  await licence('FUTURE_LICENSED', true);
  const f = fakeFetch({ matches: [] });
  assert.match((await runAdapter({ ...env, FUTURE_SOURCE_URL: 'http://feed.example.org/x.json' }, 'FUTURE_LICENSED', { now: KO, fetcher: f })).error, /https/);
  assert.equal(f.calls.length, 0);
  await licence('FUTURE_LICENSED', false);
});

test('with the licence confirmed: the API is read, the key is sent, a report is added for the right match', async () => {
  await licence('LICENSED_API', true);
  const f = fakeFetch(apiFootball(HOME, AWAY, 2, 1, 'FT'));
  const r = await runAdapter(env, 'LICENSED_API', { now: KO + 110 * 60e3, fetcher: f });
  assert.equal(r.ok, true, r.error);
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].url, /^https:\/\/v3\.football\.api-sports\.io\/fixtures\?league=999&season=2026&date=2026-11-08$/);
  assert.equal(f.calls[0].init.headers['x-apisports-key'], 'k-test');
  assert.equal(r.reports.length, 1);
  assert.equal(r.reports[0].fixtureId, FX);
  const rep = await DB.prepare(`SELECT * FROM score_reports WHERE id = ?`).bind(r.reports[0].id).first();
  assert.deepEqual([rep.source_type, rep.home_goals, rep.away_goals, rep.status], ['LICENSED_API', 2, 1, 'FULL_TIME']);
  const src = await DB.prepare(`SELECT last_success_at, last_error FROM score_sources WHERE type = 'LICENSED_API'`).first();
  assert.ok(src.last_success_at);
  assert.equal(src.last_error, null);
  const cov = await coverageTest(env, 'LICENSED_API', { now: KO, fetcher: fakeFetch(apiFootball(HOME, 'Kano Pillars', 0, 0, 'NS')) });
  assert.match(cov.result, /0 recognised/);
  assert.match(cov.result, /Kano Pillars/);
});

test('an error from the provider is recorded for the status panel', async () => {
  const bad = async () => ({ ok: false, status: 401, json: async () => ({}) });
  const r = await runAdapter(env, 'LICENSED_API', { now: KO, fetcher: bad });
  assert.match(r.error, /401.*key/);
  assert.match((await DB.prepare(`SELECT last_error FROM score_sources WHERE type = 'LICENSED_API'`).first()).last_error, /401/);
});

test('polling: every 2 minutes on matchdays, every 6 hours otherwise', async () => {
  const f = fakeFetch(apiFootball(HOME, AWAY, 1, 0, '2H'));
  await DB.prepare(`UPDATE score_sources SET last_checked_at = NULL WHERE type = 'LICENSED_API'`).run();
  const t0 = KO + 30 * 60e3;
  assert.equal((await pollSources(env, settings, { now: t0, fetcher: f })).length, 1, 'first check');
  assert.equal((await pollSources(env, settings, { now: t0 + 60e3, fetcher: f })).length, 0, '1 minute later: not yet');
  assert.equal((await pollSources(env, settings, { now: t0 + 2 * 60e3, fetcher: f })).length, 1, '2 minutes later');
  const quiet = KO + 3 * 864e5;
  assert.equal((await pollSources(env, settings, { now: quiet, fetcher: f })).length, 1);
  assert.equal((await pollSources(env, settings, { now: quiet + 2 * 3600e3, fetcher: f })).length, 0, 'not a matchday: 2 hours is too soon');
  assert.equal((await pollSources(env, settings, { now: quiet + 6 * 3600e3, fetcher: f })).length, 1, '6 hours later');
});
