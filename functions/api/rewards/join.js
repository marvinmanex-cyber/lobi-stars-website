import { readSession } from '../_lib/session.js';
import { ensureFanSchema, clientIp, rateLimit, tooMany } from '../_lib/fans.js';
import { ensureRewardsSchema, joinRewards, memberNo, pointsSummary } from '../_lib/rewards.js';

// POST /api/rewards/join { agree: true } -- a signed-in fan joins Lobi Stars
// Rewards with one click (after ticking "I agree to the Rewards Terms").
// Joining twice does nothing. Points are only earned once the email is verified.
export async function onRequestPost({ request, env }) {
  try {
    const db = env.DB;
    await ensureFanSchema(db);
    if (!(await rateLimit(db, `rewards-join:${clientIp(request)}`, 20, 3600))) return tooMany();
    const memberId = await readSession(request, env.SESSION_SECRET);
    if (!memberId) return Response.json({ error: 'Please log in first.' }, { status: 401 });
    const b = await request.json().catch(() => ({}));
    if (b.agree !== true) return Response.json({ error: 'Please tick "I agree to the Lobi Stars Rewards Terms".' }, { status: 400 });
    await ensureRewardsSchema(db);
    const r = await joinRewards(db, memberId, 'one-click');
    const sum = await pointsSummary(db, memberId);
    return Response.json({ ok: true, memberNo: memberNo(r.seq), verified: !!r.email_verified, balance: sum.balance });
  } catch (err) {
    console.error('[rewards] join', err);
    return Response.json({ error: 'Could not join just now. Please try again.' }, { status: 500 });
  }
}
