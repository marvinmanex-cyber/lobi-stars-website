// /api/matches/:slug/motm -- the older per-match address, kept for links and tests. It uses the same
// service and rules as /api/motm/current.json and /api/motm/vote (one set of voting rules).
import { motmStatus, castVote } from '../../_lib/motmService.js';
import { recordServerEvent } from '../../_lib/analytics.js';
import { earnVote } from '../../_lib/rewardsEarn.js';

const STATE = { upcoming: 'before', open: 'open', closed: 'closed', cancelled: 'off' };
export async function onRequestGet({ request, env, params }) {
  const s = await motmStatus(env, request, params.slug);
  if (s.status === 'not_home' || s.status === 'no_match') return Response.json({ error: 'Man of the Match voting is only for Lobi Stars home games.' }, { status: 404 });
  const a = s.announcement;
  return Response.json({
    ...s, state: STATE[s.status], kickoff: s.kickoff,
    players: (s.candidates || []).map(p => ({ ...p, photo: p.photoUrl })),
    results: a ? { total: a.totalVotes, winners: a.winner ? [a.winner.slug] : [], rows: (a.top3 || []).map((r, i) => ({ ...r, pct: r.percent, winner: i === 0 })) } : null,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function onRequestPost({ request, env, params }) {
  const b = await request.json().catch(() => ({}));
  const r = await castVote(env, request, params.slug, b.player ?? b.playerId);
  if (r.error) return Response.json({ error: r.error, code: r.code }, { status: r.status });
  await recordServerEvent(env, 'motm_vote', r.match.slug, request);
  await earnVote(env, r.fan.id, r.match);
  return Response.json({ ok: true, myVote: r.myVote }, { headers: { 'Cache-Control': 'no-store' } });
}
