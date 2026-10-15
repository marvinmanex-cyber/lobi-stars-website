import { readSession } from '../_lib/session.js';
import { ensureRewardsSchema } from '../_lib/rewards.js';

// GET /api/rewards/history?filter=all|earned|used|pending|expired|removed&before=<id>
// The signed-in fan's points history in plain English, newest first, 30 at a time.
// Pending ticket points say which match they wait for.
const FILTERS = {
  all: '1 = 1',
  earned: "l.type IN ('EARN', 'BONUS') AND l.status = 'AVAILABLE'",
  used: "l.type = 'REDEEM' AND l.status != 'REVERSED'",
  pending: "l.status = 'PENDING'",
  expired: "l.type = 'EXPIRE'",
  removed: "(l.type = 'REVERSE' OR l.status = 'REVERSED')",
};
export async function onRequestGet({ request, env }) {
  const headers = { 'Cache-Control': 'no-store' };
  const memberId = await readSession(request, env.SESSION_SECRET).catch(() => null);
  if (!memberId) return Response.json({ error: 'Please log in first.' }, { status: 401, headers });
  try {
    const db = env.DB;
    await ensureRewardsSchema(db);
    const url = new URL(request.url);
    const where = FILTERS[url.searchParams.get('filter')] || FILTERS.all;
    const before = Number(url.searchParams.get('before')) || 1e15;
    const { results } = await db.prepare(`SELECT l.id, l.type, l.points, l.status, l.source, l.description, l.created_at, l.available_at, e.home_team, e.away_team, e.event_date
      FROM rewards_ledger l LEFT JOIN events e ON e.id = l.event_id AND l.status = 'PENDING'
      WHERE l.member_id = ? AND l.id < ? AND ${where} ORDER BY l.id DESC LIMIT 31`).bind(memberId, before).all();
    const items = results.slice(0, 30).map(r => ({
      id: r.id, type: r.type, points: r.points, status: r.status, source: r.source, description: r.description, createdAt: r.created_at,
      waitsFor: r.status === 'PENDING' && r.home_team ? { match: `${r.home_team} vs ${r.away_team}`, date: r.event_date } : null,
    }));
    return Response.json({ items, more: results.length > 30 }, { headers });
  } catch (err) {
    console.error('[rewards] history', err);
    return Response.json({ error: 'Could not load your history.' }, { status: 500, headers });
  }
}
