import { leagueAuth, body, ok, fail, snapshot, afterFixtureChange } from '../../../_lib/leagueAdmin.js';
import { loadLeague, logLeague, fixtureJson, listCompetitions } from '../../../_lib/leagueDb.js';
import { validateFixtureInput, STATUSES } from '../../../_lib/league/validate.js';
import { isCounted } from '../../../_lib/league/standings.js';

// GET  /api/admin/league/fixtures?competition=&matchday=&status=&q=
//      Every fixture (published or not), with the clubs, venues and competitions
//      the editing screens need.
// POST /api/admin/league/fixtures { competitionId, homeTeamId, awayTeamId, date, time, venueId?, matchday?, note? }
//      Adds a fixture to any competition (league, cup or friendly).
export async function onRequestGet({ request, env }) {
  const { denied } = await leagueAuth(request, env);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const slug = url.searchParams.get('competition');
    if (slug && !/^[a-z0-9-]{1,80}$/.test(slug)) return fail('Unknown competition.');
    const league = await loadLeague(env, { slug: slug || null, publishedOnly: false });
    if (!league) return fail('No competition found.', 404);
    let list = league.fixtures;
    const md = url.searchParams.get('matchday');
    if (md) { if (!/^\d{1,2}$/.test(md)) return fail('Unknown matchday.'); list = list.filter(f => f.matchday === Number(md)); }
    const st = url.searchParams.get('status');
    if (st) { if (!STATUSES.includes(st)) return fail('Unknown status.'); list = list.filter(f => f.status === st); }
    const q = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 60);
    if (q) list = list.filter(f => [f.home?.name, f.away?.name, f.venue?.name, f.note].some(v => String(v || '').toLowerCase().includes(q)));
    const now = Date.now();
    return ok({
      competition: league.competition, competitions: await listCompetitions(env.DB),
      teams: league.allTeams, competitionTeams: league.teams.map(t => t.id), venues: league.venues,
      fixtures: list.map(f => ({ ...fixtureJson(f, url.origin), venueId: f.venue_id, homeTeamId: f.home_team_id, awayTeamId: f.away_team_id, isPublished: !!f.is_published,
        eventId: f.event_id || null, updatedBy: f.updated_by, counted: isCounted(f, league.competition),
        resultDue: ['scheduled', 'live', 'half_time'].includes(f.status) && f.kickoff_at && Date.parse(f.kickoff_at) < now - 2 * 3600e3 })),
    });
  } catch (err) {
    console.error('[league admin] fixtures', err);
    return fail('Could not load the fixtures.', 500);
  }
}

export async function onRequestPost({ request, env }) {
  const { staff, denied } = await leagueAuth(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    const b = await body(request);
    if (!b) return fail('Send the fixture details.');
    const comp = await db.prepare(`SELECT * FROM league_competitions WHERE id = ?`).bind(Number(b.competitionId)).first();
    if (!comp) return fail('Choose a competition.');
    const v = validateFixtureInput({ ...b, status: undefined }, { partial: false });
    if (!v.ok) return fail(v.error);
    if (!v.value.kickoff_at) return fail('Enter the date and time.');
    for (const id of [v.value.home_team_id, v.value.away_team_id]) {
      if (!(await db.prepare(`SELECT id FROM league_teams WHERE id = ?`).bind(id).first())) return fail('Unknown team.');
    }
    if (comp.type === 'league' && v.value.matchday == null) return fail('League fixtures need a matchday.');
    let venueId = v.value.venue_id;
    if (venueId === undefined) venueId = (await db.prepare(`SELECT home_venue_id FROM league_teams WHERE id = ?`).bind(v.value.home_team_id).first())?.home_venue_id ?? null;
    const next = (await db.prepare(`SELECT COALESCE(MAX(match_no), 0) + 1 AS n FROM league_fixtures WHERE competition_id = ?`).bind(comp.id).first()).n;
    // Every club joins the competition's club list when it plays in it.
    for (const id of [v.value.home_team_id, v.value.away_team_id]) await db.prepare(`INSERT OR IGNORE INTO league_competition_teams (competition_id, team_id) VALUES (?, ?)`).bind(comp.id, id).run();
    const r = await db.prepare(`INSERT INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, note, is_published, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, 1, ?)`)
      .bind(comp.id, next, v.value.matchday ?? null, v.value.matchday ? (v.value.matchday <= 7 ? 1 : 2) : null, v.value.home_team_id, v.value.away_team_id, venueId, v.value.kickoff_at, v.value.kickoff_at, v.value.note ?? null, staff.email).run();
    const f = await db.prepare(`SELECT * FROM league_fixtures WHERE id = ?`).bind(r.meta.last_row_id).first();
    await logLeague(db, staff, 'fixture.add', 'fixture', f.id, null, snapshot(f));
    await afterFixtureChange(env, f, []);
    return ok({ id: f.id, matchNo: f.match_no });
  } catch (err) {
    console.error('[league admin] add fixture', err);
    return fail('Could not add the fixture.', 500);
  }
}
