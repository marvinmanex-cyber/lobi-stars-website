import { readSession } from '../_lib/session.js';
import { ensureRewardsSchema, rewardsSettings, pointsSummary } from '../_lib/rewards.js';

// GET /api/rewards/balance -- light call for the header: { show, balance } for a
// signed-in Rewards member once Rewards is live (nothing for anyone else).
export async function onRequestGet({ request, env }) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const memberId = await readSession(request, env.SESSION_SECRET).catch(() => null);
    if (!memberId) return Response.json({ show: false }, { headers });
    const db = env.DB;
    await ensureRewardsSchema(db);
    const s = await rewardsSettings(db);
    const r = await db.prepare(`SELECT status FROM rewards_members WHERE member_id = ?`).bind(memberId).first();
    if (!s.live || !r || r.status !== 'active') return Response.json({ show: false }, { headers });
    return Response.json({ show: true, balance: (await pointsSummary(db, memberId)).balance }, { headers });
  } catch { return Response.json({ show: false }, { headers }); }
}
