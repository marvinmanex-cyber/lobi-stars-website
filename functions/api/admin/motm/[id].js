import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { loadMatch, toPublic } from '../../_lib/matchCentre.js';
import { staffTally } from '../../_lib/motmService.js';
import { buildCsv } from '../../_lib/xlsx.js';

// GET /api/admin/motm/:eventId[?format=csv] -- Man of the Match vote
// breakdown for staff (visible during the match too). CSV downloads are logged.
export async function onRequestGet({ request, env, params }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const m = await loadMatch(env.DB, params.id);
  if (!m) return Response.json({ error: 'Match not found' }, { status: 404 });
  const match = toPublic(m.event, m.centre);
  const t = await staffTally(env, request, match);
  // Every player who can be (or could be) voted for, with his valid votes so far.
  const rows = t.players.map(p => { const r = t.rows.find(x => x.slug === p.slug); return { slug: p.slug, name: p.name, number: p.number ?? null, position: p.position || '', votes: r?.votes || 0, pct: r?.percent || 0 }; })
    .sort((a, b) => b.votes - a.votes || (t.rows.findIndex(x => x.slug === a.slug) + 1 || 999) - (t.rows.findIndex(x => x.slug === b.slug) + 1 || 999));
  const top = t.rows[0]?.slug || null;
  const board = { total: t.totalVotes, held: t.held, rows: rows.map(r => ({ ...r, winner: r.slug === top })), winners: top ? [top] : [] };
  const win = t.win;

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
  return Response.json({ state: win.status, opensAt: win.opensAt, closesAt: win.closesAt, ...board }, { headers: { 'Cache-Control': 'no-store' } });
}
