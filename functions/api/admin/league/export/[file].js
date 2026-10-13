import { leagueAuth, fail } from '../../../_lib/leagueAdmin.js';
import { loadLeague, standingsFor } from '../../../_lib/leagueDb.js';
import { toCsv } from '../../../_lib/league/csv.js';
import { toLagos } from '../../../_lib/league/time.js';

// GET /api/admin/league/export/fixtures.csv?competition=  (same columns as the import, plus status and score)
// GET /api/admin/league/export/table.csv?competition=
// GET /api/admin/league/export/template.csv                (empty import template)
export async function onRequestGet({ request, env, params }) {
  const { denied } = await leagueAuth(request, env);
  if (denied) return denied;
  try {
    const file = params.file;
    const send = (name, csv) => new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } });
    if (file === 'template.csv') {
      return send('fixtures-template.csv', toCsv(['match_no', 'matchday', 'date', 'time', 'home', 'away', 'venue'], [{ match_no: 1, matchday: 1, date: '2026-11-07', time: '16:00', home: 'Yobe Desert Stars FC', away: 'Mighty Jets FC', venue: 'August 27 Stadium, Damaturu' }]));
    }
    const slug = new URL(request.url).searchParams.get('competition');
    const league = await loadLeague(env, { slug: slug && /^[a-z0-9-]{1,80}$/.test(slug) ? slug : null, publishedOnly: false });
    if (!league) return fail('No competition found.', 404);
    const stamp = new Date().toISOString().slice(0, 10);
    if (file === 'fixtures.csv') {
      const rows = league.fixtures.sort((a, b) => a.match_no - b.match_no).map(f => {
        const k = toLagos(f.kickoff_at || f.original_kickoff_at) || {};
        return { match_no: f.match_no, matchday: f.matchday, date: k.date || '', time: k.time || '', home: f.home?.name, away: f.away?.name, venue: f.venue?.name || '',
          status: f.status, home_goals: f.home_goals ?? '', away_goals: f.away_goals ?? '', note: f.note || '', postponed_reason: f.postponed_reason || '' };
      });
      return send(`${league.competition.slug}-fixtures-${stamp}.csv`, toCsv(['match_no', 'matchday', 'date', 'time', 'home', 'away', 'venue', 'status', 'home_goals', 'away_goals', 'note', 'postponed_reason'], rows));
    }
    if (file === 'table.csv') {
      const s = standingsFor(league);
      const rows = s.rows.map(r => ({ pos: r.pos, club: r.team.name, played: r.played, won: r.won, drawn: r.drawn, lost: r.lost, gf: r.gf, ga: r.ga, gd: r.gd, adjustment: r.adjustment, points: r.points, form: r.form.join('') }));
      return send(`${league.competition.slug}-table-${stamp}.csv`, toCsv(['pos', 'club', 'played', 'won', 'drawn', 'lost', 'gf', 'ga', 'gd', 'adjustment', 'points', 'form'], rows));
    }
    return fail('Unknown file.', 404);
  } catch (err) {
    console.error('[league admin] export', err);
    return fail('Could not make the file.', 500);
  }
}
