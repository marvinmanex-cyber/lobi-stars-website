import { currentFan } from '../_lib/matchdayFan.js';
import { ensureAwardsSchema, publicAwards, totalAwardVoters } from '../_lib/awards.js';
import { awardsAssets } from '../_lib/awardsData.js';

// GET /api/awards -- every award (open, upcoming and past) with the signed-in
// fan's own votes. Vote counts only appear once voting has closed.
export async function onRequestGet({ request, env }) {
  await ensureAwardsSchema(env.DB);
  const awards = await publicAwards(env.DB, await awardsAssets(env, request));
  const fan = await currentFan(request, env);
  const mine = {};
  if (fan) {
    const { results } = await env.DB.prepare(`SELECT award_id, nominee_id, created_at FROM award_votes WHERE member_id = ?`).bind(fan.id).all();
    for (const r of results) mine[r.award_id] = { nominee: r.nominee_id, at: r.created_at };
  }
  for (const a of awards) if (a.state === 'open') a.totalVoters = await totalAwardVoters(env.DB, a.id);
  return Response.json({
    awards,
    fan: fan ? { firstName: fan.first_name, verified: !!fan.email_verified } : null,
    myVotes: mine,
    serverTime: new Date().toISOString(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
