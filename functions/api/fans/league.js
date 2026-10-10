import { currentFan } from '../_lib/matchdayFan.js';
import { seasonLeague } from '../_lib/predictLeague.js';
import { seasonConfig } from '../_lib/seasonConfig.js';

// GET /api/fans/league -- the signed-in fan's Prediction League position this season.
export async function onRequestGet({ request, env }) {
  const fan = await currentFan(request, env);
  if (!fan) return Response.json({ error: 'Please log in.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  const data = await seasonLeague(env.DB, await seasonConfig(env, request));
  const me = data.rows.find(r => r.memberId === fan.id);
  return Response.json({
    season: data.season,
    of: data.rows.length,
    staff: !!fan.is_staff,
    me: me ? { rank: me.rank, points: me.points, exact: me.exact, predictions: me.predictions } : null,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
