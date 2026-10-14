import { readSession } from '../_lib/session.js';
import { clientIp, rateLimit, tooMany, ensureFanSchema } from '../_lib/fans.js';
import { ensureRewardsSchema, rewardsMember } from '../_lib/rewards.js';
import { tierStatus, celebration } from '../_lib/rewardsTiers.js';

// POST /api/rewards/tier { action: 'seen' }            -- the tier celebration was shown (once per new tier per season)
// POST /api/rewards/tier { action: 'legend-wall', optIn } -- Legend members choose to appear on the Legend Fans wall
//      (first name and surname initial only).
export async function onRequestPost({ request, env }) {
  try {
    const db = env.DB;
    await ensureFanSchema(db);
    if (!(await rateLimit(db, `rewards-tier:${clientIp(request)}`, 60, 3600))) return tooMany();
    const memberId = await readSession(request, env.SESSION_SECRET);
    if (!memberId) return Response.json({ error: 'Please log in first.' }, { status: 401 });
    await ensureRewardsSchema(db);
    if (!(await rewardsMember(db, memberId))) return Response.json({ error: 'Join Lobi Stars Rewards first.' }, { status: 403 });
    const b = await request.json().catch(() => ({}));
    const st = await tierStatus(db, memberId);
    if (b.action === 'seen') { await celebration(db, memberId, st, { seen: true }); return Response.json({ ok: true }); }
    if (b.action === 'legend-wall') {
      if (b.optIn && st.tier.key !== 'legend') return Response.json({ error: 'The Legend Fans wall is for Legend members.' }, { status: 403 });
      await db.prepare(`UPDATE rewards_members SET legend_wall = ? WHERE member_id = ?`).bind(b.optIn ? 1 : 0, memberId).run();
      return Response.json({ ok: true, legendWall: !!b.optIn });
    }
    return Response.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    console.error('[rewards] tier', err);
    return Response.json({ error: 'Could not save just now.' }, { status: 500 });
  }
}
