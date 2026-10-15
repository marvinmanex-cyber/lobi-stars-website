import { readSession } from '../_lib/session.js';
import { ensureFanSchema } from '../_lib/fans.js';
import { rewardsSettings, rewardsMember } from '../_lib/rewards.js';
import { tierStatus } from '../_lib/rewardsTiers.js';
import { listItems, spendable, eligibility, ensureCatalogueSchema } from '../_lib/rewardsCatalogue.js';

// GET /api/rewards/catalogue -- the rewards fans can redeem (live from the
// admin catalogue), each with points cost and, for a signed-in member, whether
// they can redeem it now ("You need X more points"). No personal data.
export async function onRequestGet({ request, env }) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const db = env.DB;
    await ensureFanSchema(db);
    await ensureCatalogueSchema(db);
    const s = await rewardsSettings(db);
    const items = await listItems(db);
    const memberId = await readSession(request, env.SESSION_SECRET).catch(() => null);
    const m = memberId ? await rewardsMember(db, memberId) : null;
    let balance = null, tierKey = null, used = new Map();
    if (m) {
      balance = await spendable(db, memberId);
      tierKey = (await tierStatus(db, memberId)).tier.key;
      used = new Map((await db.prepare(`SELECT item_id, COUNT(*) AS n FROM rewards_redemptions WHERE member_id = ? AND status != 'refunded' GROUP BY item_id`).bind(memberId).all()).results.map(r => [r.item_id, r.n]));
    }
    const out = [];
    for (const it of items) {
      const e = m ? await eligibility(db, m, it, { balance, tierKey, used: used.get(it.id) || 0 }) : null;
      out.push({ id: it.id, name: it.name, description: it.description, image: it.image, type: it.type, group: it.group, points: it.points,
        valueKobo: it.config.valueKobo ?? null, stock: it.stock, sponsor: it.sponsor, minAge: it.minAge, minTier: it.minTier,
        canRedeem: e ? e.ok : null, reason: e && !e.ok ? e.reason : null, needsCode: it.points >= s.redeemCodeThreshold });
    }
    return Response.json({ live: !!s.live, member: !!m, balance, items: out, codeFrom: s.redeemCodeThreshold }, { headers });
  } catch (err) {
    console.error('[rewards] catalogue', err);
    return Response.json({ error: 'Could not load the rewards.' }, { status: 500, headers });
  }
}
