// POST /api/motm/vote { playerId, match? } -- the fan's one Man of the Match vote, with every rule in
// motmRules.js (window, home games only, verified accounts, players taking part, one vote each,
// new accounts held).
import { castVote } from '../_lib/motmService.js';
import { rateLimit, tooMany, clientIp } from '../_lib/fans.js';
import { recordServerEvent } from '../_lib/analytics.js';
import { earnVote } from '../_lib/rewardsEarn.js';

export async function onRequestPost({ request, env }) {
  const b = await request.json().catch(() => ({}));
  if (!(await rateLimit(env.DB, `motm-vote:${clientIp(request)}`, 60, 600))) return tooMany();
  const r = await castVote(env, request, String(b.match || ''), b.playerId ?? b.player);
  if (r.error) return Response.json({ error: r.error, code: r.code }, { status: r.status, headers: { 'Cache-Control': 'no-store' } });
  await recordServerEvent(env, 'motm_vote', r.match.slug, request);
  await earnVote(env, r.fan.id, r.match); // Lobi Stars Rewards (monthly limit applies)
  return Response.json({ ok: true, myVote: r.myVote }, { headers: { 'Cache-Control': 'no-store' } });
}
