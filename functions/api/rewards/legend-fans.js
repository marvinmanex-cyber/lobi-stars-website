import { ensureRewardsSchema, rewardsSettings } from '../_lib/rewards.js';
import { tierStatus } from '../_lib/rewardsTiers.js';

// GET /api/rewards/legend-fans -- the Legend Fans wall: Legend members who chose to
// appear, as first name + surname initial only (e.g. "Terver I."). Nothing
// else about them is shown. Empty until Rewards is live.
export async function onRequestGet({ env }) {
  const headers = { 'Cache-Control': 'public, max-age=300' };
  try {
    const db = env.DB;
    await ensureRewardsSchema(db);
    const s = await rewardsSettings(db);
    if (!s.live) return Response.json({ fans: [] }, { headers });
    const { results } = await db.prepare(`SELECT r.member_id, m.first_name, m.last_name FROM rewards_members r JOIN members m ON m.id = r.member_id
      WHERE r.legend_wall = 1 AND r.status = 'active' AND m.email_verified = 1 ORDER BY r.seq LIMIT 500`).all();
    const fans = [];
    for (const r of results) {
      if ((await tierStatus(db, r.member_id)).tier.key !== 'legend') continue;
      fans.push(`${String(r.first_name || '').trim()} ${String(r.last_name || '').trim().charAt(0).toUpperCase()}.`.trim());
    }
    return Response.json({ fans }, { headers });
  } catch (err) {
    console.error('[rewards] legend fans', err);
    return Response.json({ fans: [] }, { headers });
  }
}
