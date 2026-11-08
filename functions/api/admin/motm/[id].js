import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { loadMatch, toPublic } from '../../_lib/matchCentre.js';
import { ensureMotmSchema, leaderboard, votingWindow, playersOnField, votingSquad, lobiSide } from '../../_lib/motm.js';
import { buildCsv } from '../../_lib/xlsx.js';

// GET /api/admin/motm/:eventId[?format=csv] -- Man of the Match vote
// breakdown for staff (visible during the match too). CSV downloads are logged.
export async function onRequestGet({ request, env, params }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const m = await loadMatch(env.DB, params.id);
  if (!m) return Response.json({ error: 'Match not found' }, { status: 404 });
  await ensureMotmSchema(env.DB);
  const match = toPublic(m.event, m.centre);
  const players = playersOnField(await votingSquad(env.DB, match), match.timeline, lobiSide(match));
  const board = await leaderboard(env.DB, match.id, null, players);
  const win = votingWindow(match);

  if (new URL(request.url).searchParams.get('format') === 'csv') {
    await logAdminAction(env.DB, admin, 'export_motm_csv', `${match.home_team} vs ${match.away_team}`);
    const csv = buildCsv(['Rank', 'Player', 'Shirt Number', 'Position', 'Votes', '% of votes', 'Man of the Match'],
      board.rows.map((r, i) => [i + 1, r.name, r.number ?? '', r.position || '', r.votes, r.pct, r.winner ? 'Yes' : ''])
        .concat([[], ['Total votes', board.total], ['Match', `${match.home_team} vs ${match.away_team}`], ['Status', match.status]]));
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="motm-votes-${match.slug}.csv"`,
      },
    });
  }
  return Response.json({ state: win.state, opensAt: win.opensAt, closesAt: win.closesAt, ...board }, { headers: { 'Cache-Control': 'no-store' } });
}
