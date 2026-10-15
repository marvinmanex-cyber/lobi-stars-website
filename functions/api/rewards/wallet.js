import { readSession } from '../_lib/session.js';
import { ensureCatalogueSchema, publicRedemption } from '../_lib/rewardsCatalogue.js';

// GET /api/rewards/wallet -- the signed-in fan's redeemed rewards: vouchers
// (code, value, expiry), reward tickets, experience and item requests. Newest first.
export async function onRequestGet({ request, env }) {
  const headers = { 'Cache-Control': 'no-store' };
  const memberId = await readSession(request, env.SESSION_SECRET).catch(() => null);
  if (!memberId) return Response.json({ error: 'Please log in first.' }, { status: 401, headers });
  try {
    await ensureCatalogueSchema(env.DB);
    const { results } = await env.DB.prepare(`SELECT * FROM rewards_redemptions WHERE member_id = ? ORDER BY created_at DESC LIMIT 100`).bind(memberId).all();
    return Response.json({ items: results.map(publicRedemption) }, { headers });
  } catch (err) {
    console.error('[rewards] wallet', err);
    return Response.json({ error: 'Could not load your rewards.' }, { status: 500, headers });
  }
}
