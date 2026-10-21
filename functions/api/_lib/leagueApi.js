// Shared by the public league APIs (/api/league/*) and the server-rendered
// /fixtures, /results and /table pages: parameter checks, filters and the
// JSON shapes.
import { loadLeague, standingsFor, tableUpdatedAt, fixtureJson } from './leagueDb.js';
import { isCounted, tiebreakInWords, nextFixture, lastResult, buildFormGuide, byKickoff } from './league/standings.js';
import { toLagos } from './league/time.js';

export const CACHE = 'public, max-age=30, stale-while-revalidate=120';
export const json = (data, status = 200, cache = CACHE) => Response.json(data, { status, headers: { 'Cache-Control': status === 200 ? cache : 'no-store' } });
export const badRequest = msg => json({ error: msg }, 400);

const SLUG = /^[a-z0-9-]{1,80}$/;
export const FIX_STATUSES = ['scheduled', 'live', 'half_time', 'full_time', 'postponed', 'abandoned', 'cancelled', 'awarded'];

/** Reads the competition parameter and loads the league; returns { league } or { error: Response }. */
export async function leagueFrom(env, url) {
  const c = url.searchParams.get('competition');
  if (c !== null && c !== '' && !SLUG.test(c)) return { error: badRequest('Unknown competition.') };
  const league = await loadLeague(env, { slug: c || null });
  if (!league) return { error: json({ error: 'No competition found.' }, 404) };
  return { league };
}

/** A team by code or slug ('lobi' means the Lobi Stars team). */
export function findTeam(league, value) {
  if (!value) return null;
  const v = String(value).toLowerCase();
  return league.allTeams.find(t => (v === 'lobi' && t.is_lobi) || t.code.toLowerCase() === v || t.slug === v) || null;
}

const intParam = (url, name, min, max) => {
  const v = url.searchParams.get(name);
  if (v === null || v === '') return { value: null };
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? { value: n } : { error: `${name} must be a whole number from ${min} to ${max}.` };
};
const dateParam = (url, name) => {
  const v = url.searchParams.get(name);
  if (v === null || v === '') return { value: null };
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? { value: v } : { error: `${name} must be YYYY-MM-DD.` };
};

/** Applies ?team=&matchday=&status=&venue=&from=&to=&ha= ; returns { list } or { error }. */
export function filterFixtures(league, url) {
  let list = [...league.fixtures];
  const teamParam = url.searchParams.get('team');
  const team = teamParam ? findTeam(league, teamParam) : null;
  if (teamParam && !team) return { error: 'Unknown team.' };
  const md = intParam(url, 'matchday', 1, 60); if (md.error) return { error: md.error };
  const from = dateParam(url, 'from'); if (from.error) return { error: from.error };
  const to = dateParam(url, 'to'); if (to.error) return { error: to.error };
  const status = url.searchParams.get('status');
  if (status && !status.split(',').every(s => FIX_STATUSES.includes(s))) return { error: 'Unknown status.' };
  const ha = url.searchParams.get('ha');
  if (ha && !['home', 'away'].includes(ha)) return { error: 'ha must be home or away.' };
  if (ha && !team) return { error: 'ha needs a team.' };
  const venue = url.searchParams.get('venue');
  if (venue && !/^\d{1,6}$/.test(venue)) return { error: 'Unknown venue.' };
  if (team) list = list.filter(f => (ha === 'home' ? f.home_team_id === team.id : ha === 'away' ? f.away_team_id === team.id : f.home_team_id === team.id || f.away_team_id === team.id));
  if (md.value) list = list.filter(f => f.matchday === md.value);
  if (status) { const s = status.split(','); list = list.filter(f => s.includes(f.status)); }
  if (venue) list = list.filter(f => f.venue_id === Number(venue));
  const day = f => toLagos(f.kickoff_at || f.original_kickoff_at)?.date || '';
  if (from.value) list = list.filter(f => day(f) >= from.value);
  if (to.value) list = list.filter(f => day(f) <= to.value);
  return { list: list.sort(byKickoff), team };
}

export function matchdaySummary(league) {
  const fx = league.fixtures.filter(f => f.matchday != null);
  const total = fx.length;
  const played = fx.filter(f => isCounted(f, { ...league.competition, include_live: 0 })).length;
  const days = [...new Set(fx.map(f => f.matchday))].sort((a, b) => a - b);
  // The current matchday: the first one with a match not yet finished (or the last).
  const open = days.find(d => fx.some(f => f.matchday === d && !['full_time', 'awarded', 'cancelled'].includes(f.status)));
  return { current: open ?? days[days.length - 1] ?? null, played, total, matchdays: days.length };
}

export function tablePayload(league, { scope = 'overall', upTo = null } = {}) {
  const s = standingsFor(league, { scope, upTo });
  const comp = league.competition;
  const row = r => ({
    pos: r.pos, team: { id: r.team.id, code: r.team.code, name: r.team.name, shortName: r.team.short_name, crest: r.team.crest_url || `/api/league/crest/${r.team.code}`, isLobi: !!r.team.is_lobi },
    played: r.played, won: r.won, drawn: r.drawn, lost: r.lost, gf: r.gf, ga: r.ga, gd: r.gd, points: r.points, adjustment: r.adjustment,
    form: r.form, movement: r.movement, level: r.level, tiedWith: r.tiedWith, decidedBy: r.decidedBy,
  });
  const teamName = id => league.allTeams.find(t => t.id === id)?.name || '';
  const footnotes = [
    ...(scope === 'overall' ? league.adjustments.filter(a => a.is_active === 1).map(a => `${teamName(a.team_id)}: ${a.points_delta > 0 ? '+' : ''}${a.points_delta} point${Math.abs(a.points_delta) === 1 ? '' : 's'} (${a.reason}${a.official_ref ? `; ${a.official_ref}` : ''}).`) : []),
    tiebreakInWords(comp),
    `${comp.points_win} points for a win, ${comp.points_draw} for a draw${comp.points_loss ? `, ${comp.points_loss} for a defeat` : ''}. Only finished matches count${comp.include_live ? ' (live matches count as they stand)' : ''}; postponed, abandoned and cancelled matches don't.`,
  ];
  const fx = league.fixtures.filter(f => f.matchday != null);
  return {
    competition: { slug: comp.slug, name: comp.name, shortName: comp.short_name, season: comp.season, startDate: comp.start_date },
    scope, upto: upTo, rows: s.rows.map(row), footnotes, zones: comp.zones, matchday: s.matchday,
    matchesPlayed: upTo == null ? s.matchesPlayed : fx.filter(f => f.matchday <= upTo && isCounted(f, comp)).length,
    matchesTotal: upTo == null ? fx.length : fx.filter(f => f.matchday <= upTo).length,
    matchdayMatches: s.matchday == null ? 0 : fx.filter(f => f.matchday === s.matchday).length,
    matchdayPlayed: s.matchday == null ? 0 : fx.filter(f => f.matchday === s.matchday && isCounted(f, comp)).length,
    preSeason: s.preSeason, updatedAt: tableUpdatedAt(league),
  };
}

export function overviewPayload(league, origin = '') {
  const lobi = league.allTeams.find(t => t.is_lobi);
  const comp = league.competition;
  const nl = lobi ? nextFixture(lobi.id, league.fixtures) : null;
  const ll = lobi ? lastResult(lobi.id, league.fixtures, comp) : null;
  return {
    competition: { slug: comp.slug, name: comp.name, shortName: comp.short_name, season: comp.season, type: comp.type, hasTable: !!comp.has_table,
      startDate: comp.start_date, endDate: comp.end_date, break: comp.break_start ? { start: comp.break_start, end: comp.break_end, label: comp.break_label } : null },
    rules: { pointsWin: comp.points_win, pointsDraw: comp.points_draw, pointsLoss: comp.points_loss, tiebreakOrder: comp.tiebreak, zones: comp.zones, includeLive: !!comp.include_live },
    teams: league.teams.map(t => ({ id: t.id, code: t.code, name: t.name, shortName: t.short_name, slug: t.slug, crest: t.crest_url || `/api/league/crest/${t.code}`, colour: t.colour, isLobi: !!t.is_lobi })),
    matchday: matchdaySummary(league),
    nextLobi: nl ? fixtureJson(nl, origin) : null,
    lastLobi: ll ? fixtureJson(ll, origin) : null,
    lobiForm: lobi ? buildFormGuide(lobi.id, league.fixtures, comp).map(x => x.r) : [],
    serverTime: new Date().toISOString(),
  };
}
