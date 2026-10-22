// Score verification, Phase 6: source adapters (automatic sources).
//
// LEGAL RULE: the website never scrapes or automatically reads Soccerway,
// Sofascore, Flashscore or any website whose terms forbid automated access.
// Every adapter goes through assertAdapterMayRun / assertAllowedFetch
// (model.js) before any request: the source must be switched on and, for a
// licensed source, "licence / permission confirmed" must be ON with a note. A
// prohibited host is refused unless that is set.
//
// Adapters:
//   LICENSED_API     a paid football data API used under its licence:
//                    API-Football (api-sports.io) or Sportmonks, chosen with
//                    LICENSED_API_PROVIDER; key LICENSED_API_KEY; competition
//                    LICENSED_API_LEAGUE_ID (+ LICENSED_API_SEASON for API-Football).
//   FUTURE_LICENSED  a JSON feed we get written permission or a licence for:
//                    FUTURE_SOURCE_URL returning
//                    { matches: [{ home, away, homeGoals, awayGoals, status, minute }] }.
// Polling (scoresTick): every 2 minutes on matchdays, otherwise every 6 hours
// (Score Sources › Settings). Each run records last checked / success / error.
import { ensureScoreSchema, getSource, addReport, assertAdapterMayRun, assertAllowedFetch } from './model.js';

const API_FOOTBALL_STATUS = { NS: 'SCHEDULED', TBD: 'SCHEDULED', '1H': 'LIVE', '2H': 'LIVE', ET: 'LIVE', BT: 'LIVE', P: 'LIVE', LIVE: 'LIVE', INT: 'LIVE', HT: 'HALF_TIME',
  FT: 'FULL_TIME', AET: 'FULL_TIME', PEN: 'FULL_TIME', PST: 'POSTPONED', SUSP: 'POSTPONED', ABD: 'ABANDONED', AWD: 'AWARDED', WO: 'AWARDED', CANC: 'CANCELLED' };
const SPORTMONKS_STATUS = { NS: 'SCHEDULED', TBA: 'SCHEDULED', INPLAY_1ST_HALF: 'LIVE', INPLAY_2ND_HALF: 'LIVE', INPLAY_ET: 'LIVE', INPLAY_PENALTIES: 'LIVE', BREAK: 'LIVE', HT: 'HALF_TIME',
  FT: 'FULL_TIME', AET: 'FULL_TIME', FT_PEN: 'FULL_TIME', POSTPONED: 'POSTPONED', SUSPENDED: 'POSTPONED', INTERRUPTED: 'LIVE', ABANDONED: 'ABANDONED', AWARDED: 'AWARDED', WO: 'AWARDED', CANCELLED: 'CANCELLED', DELETED: 'CANCELLED' };

/** API-Football /fixtures response → plain matches. */
export function mapApiFootball(body) {
  return (body?.response || []).map(x => ({
    externalId: String(x.fixture?.id ?? ''), home: x.teams?.home?.name, away: x.teams?.away?.name, kickoff: x.fixture?.date || null,
    status: API_FOOTBALL_STATUS[x.fixture?.status?.short] || null, minute: x.fixture?.status?.elapsed != null ? String(x.fixture.status.elapsed) : null,
    homeGoals: x.goals?.home ?? null, awayGoals: x.goals?.away ?? null,
  })).filter(m => m.home && m.away && m.status);
}
/** Sportmonks v3 fixtures (include=participants;scores;state) → plain matches. */
export function mapSportmonks(body) {
  return (body?.data || []).map(x => {
    const home = (x.participants || []).find(p => p.meta?.location === 'home'), away = (x.participants || []).find(p => p.meta?.location === 'away');
    const cur = loc => (x.scores || []).find(s => s.description === 'CURRENT' && s.score?.participant === loc)?.score?.goals ?? null;
    return { externalId: String(x.id ?? ''), home: home?.name, away: away?.name, kickoff: x.starting_at ? `${String(x.starting_at).replace(' ', 'T')}Z` : null,
      status: SPORTMONKS_STATUS[x.state?.developer_name] || null, minute: null, homeGoals: cur('home'), awayGoals: cur('away') };
  }).filter(m => m.home && m.away && m.status);
}
/** A licensed JSON feed in our own simple format. */
export function mapSimpleFeed(body) {
  return (body?.matches || []).map(m => ({ externalId: String(m.id ?? ''), home: m.home, away: m.away, kickoff: m.kickoff || null, status: String(m.status || '').toUpperCase(),
    minute: m.minute ?? null, homeGoals: m.homeGoals ?? null, awayGoals: m.awayGoals ?? null })).filter(m => m.home && m.away && m.status);
}

const day = ms => new Date(ms + 3600e3).toISOString().slice(0, 10); // Nigerian date
/** The request for a source and day: { url, headers, map } (no request is made here). */
export function requestFor(env, type, ms) {
  if (type === 'LICENSED_API') {
    const provider = String(env.LICENSED_API_PROVIDER || 'api-football').toLowerCase();
    const league = env.LICENSED_API_LEAGUE_ID;
    if (!env.LICENSED_API_KEY) throw new Error('The API key is not set (LICENSED_API_KEY in Cloudflare).');
    if (!league) throw new Error('The competition number at the provider is not set (LICENSED_API_LEAGUE_ID).');
    if (provider === 'sportmonks') {
      return { url: `https://api.sportmonks.com/v3/football/fixtures/date/${day(ms)}?include=participants;scores;state&filters=fixtureLeagues:${encodeURIComponent(league)}`,
        headers: { Authorization: env.LICENSED_API_KEY }, map: mapSportmonks, provider: 'Sportmonks' };
    }
    const season = env.LICENSED_API_SEASON || String(new Date(ms).getUTCFullYear() - (new Date(ms).getUTCMonth() < 6 ? 1 : 0));
    return { url: `https://v3.football.api-sports.io/fixtures?league=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}&date=${day(ms)}`,
      headers: { 'x-apisports-key': env.LICENSED_API_KEY }, map: mapApiFootball, provider: 'API-Football' };
  }
  if (type === 'FUTURE_LICENSED') {
    if (!env.FUTURE_SOURCE_URL) throw new Error('No feed address is set (FUTURE_SOURCE_URL).');
    return { url: env.FUTURE_SOURCE_URL, headers: env.FUTURE_SOURCE_KEY ? { Authorization: `Bearer ${env.FUTURE_SOURCE_KEY}` } : {}, map: mapSimpleFeed, provider: 'Licensed feed' };
  }
  throw new Error('This source has no automatic adapter.');
}

async function ensureAdapterColumns(env) {
  await ensureScoreSchema(env);
  const cols = (await env.DB.prepare(`PRAGMA table_info(score_sources)`).all()).results.map(c => c.name);
  for (const c of ['last_checked_at', 'last_success_at', 'last_error']) if (!cols.includes(c)) await env.DB.prepare(`ALTER TABLE score_sources ADD COLUMN ${c} TEXT`).run();
}
const note = (env, type, cols) => env.DB.prepare(`UPDATE score_sources SET ${Object.keys(cols).map(k => `${k} = ?`).join(', ')} WHERE type = ?`).bind(...Object.values(cols), type).run();

/**
 * Runs one automatic source once: checks the legal rule, fetches, adds one
 * report per match (the source counts once however often it runs).
 * fetcher is injectable for tests. Returns { ok, matches, reports } or { ok: false, error }.
 */
export async function runAdapter(env, type, { now = Date.now(), fetcher = fetch, dryRun = false } = {}) {
  await ensureAdapterColumns(env);
  const source = await getSource(env, type);
  const at = new Date(now).toISOString();
  let req;
  try {
    assertAdapterMayRun(source);            // switched on + licence confirmed with a note
    req = requestFor(env, type, now);
    assertAllowedFetch(source, req.url);    // https only; prohibited websites refused
  } catch (err) {
    if (source && !dryRun) await note(env, type, { last_checked_at: at, last_error: err.message.slice(0, 300) });
    return { ok: false, error: err.message };
  }
  let body;
  try {
    const r = await fetcher(req.url, { headers: { Accept: 'application/json', ...req.headers }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`${req.provider} answered ${r.status}${r.status === 401 || r.status === 403 ? ' (check the key and the plan)' : ''}`);
    body = await r.json();
  } catch (err) {
    const msg = err?.name === 'TimeoutError' ? `${req.provider} took too long to answer.` : err.message;
    if (!dryRun) await note(env, type, { last_checked_at: at, last_error: msg.slice(0, 300) });
    return { ok: false, error: msg };
  }
  const matches = req.map(body);
  if (dryRun) return { ok: true, matches, provider: req.provider };
  const reports = [];
  for (const m of matches.filter(x => x.status !== 'SCHEDULED')) {
    const r = await addReport(env, { sourceType: type, identity: type === 'LICENSED_API' ? 'licensed-api' : 'licensed-feed', label: req.provider, homeName: m.home, awayName: m.away,
      homeGoals: m.homeGoals, awayGoals: m.awayGoals, status: m.status, minute: m.minute, receivedAt: at, raw: { provider: req.provider, externalId: m.externalId } });
    reports.push(r.error ? { error: r.error, home: m.home, away: m.away } : { id: r.id, fixtureId: r.fixtureId, needsReview: r.needsReview });
  }
  await note(env, type, { last_checked_at: at, last_success_at: at, last_error: null });
  return { ok: true, matches: matches.length, reports };
}

/** Coverage test: how many of our fixtures the source has (by team names), for one day or the whole round. */
export async function coverageTest(env, type, { now = Date.now(), fetcher = fetch } = {}) {
  const r = await runAdapter(env, type, { now, fetcher, dryRun: true });
  if (!r.ok) return { ok: false, result: r.error };
  const { loadTeams, findTeamByName } = await import('./model.js');
  const teams = await loadTeams(env);
  const known = r.matches.filter(m => findTeamByName(teams, m.home) && findTeamByName(teams, m.away));
  const unknown = r.matches.filter(m => !known.includes(m)).slice(0, 6).map(m => `${m.home} v ${m.away}`);
  return { ok: known.length > 0, result: `${r.provider}: ${r.matches.length} match${r.matches.length === 1 ? '' : 'es'} on ${day(now)}, ${known.length} recognised as our conference teams.${unknown.length ? ` Not recognised: ${unknown.join('; ')} (link them in Unmatched Team Names).` : ''}` };
}

/** Is it a matchday (a conference match from 30 minutes before kick-off to 3 hours after)? */
export async function isMatchday(env, now = Date.now()) {
  const f = await env.DB.prepare(`SELECT 1 FROM league_fixtures WHERE kickoff_at BETWEEN ? AND ? LIMIT 1`).bind(new Date(now - 3 * 3600e3).toISOString(), new Date(now + 30 * 60e3).toISOString()).first();
  return !!f;
}

/** Called every minute: runs each automatic source when it is due. */
export async function pollSources(env, settings, { now = Date.now(), fetcher = fetch } = {}) {
  await ensureAdapterColumns(env);
  const out = [];
  const md = await isMatchday(env, now);
  const every = md ? Number(settings.poll_matchday_minutes) * 60e3 : Number(settings.poll_other_hours) * 3600e3;
  for (const type of ['LICENSED_API', 'FUTURE_LICENSED']) {
    const s = await getSource(env, type);
    if (!s?.enabled) continue;
    if (s.last_checked_at && now - Date.parse(s.last_checked_at) < every - 5e3) continue;
    out.push({ type, ...(await runAdapter(env, type, { now, fetcher })) });
  }
  return out;
}
