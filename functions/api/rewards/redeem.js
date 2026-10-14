import { readSession } from '../_lib/session.js';
import { ensureFanSchema, rateLimit, tooMany } from '../_lib/fans.js';
import { rewardsSettings } from '../_lib/rewards.js';
import { ensureCatalogueSchema, listItems, redeem, sendRedeemCode } from '../_lib/rewardsCatalogue.js';

// POST /api/rewards/redeem { itemId, key, code?, network?, phone?, eventId?, notes? }
//   Redeems a reward. `key` is a random id made when the fan presses Confirm
//   (the same key twice = the same redemption, so a double click spends once).
//   Rewards of `redeemCodeThreshold` points or more need the emailed code.
// POST /api/rewards/redeem { action: 'code', itemId } -- emails that code.
// Only once Rewards is live. Points have no cash value.
export async function onRequestPost({ request, env }) {
  try {
    const db = env.DB;
    await ensureFanSchema(db);
    const memberId = await readSession(request, env.SESSION_SECRET);
    if (!memberId) return Response.json({ error: 'Please log in first.' }, { status: 401 });
    if (!(await rateLimit(db, `rewards-redeem:${memberId}`, 30, 3600))) return tooMany();
    await ensureCatalogueSchema(db);
    const s = await rewardsSettings(db);
    if (!s.live) return Response.json({ error: 'Lobi Stars Rewards is not open yet.' }, { status: 403 });
    const b = await request.json().catch(() => ({}));
    if (b.action === 'code') {
      if (!(await rateLimit(db, `rewards-code:${memberId}`, 6, 3600))) return tooMany();
      const item = (await listItems(db)).find(i => i.id === String(b.itemId || ''));
      if (!item) return Response.json({ error: 'That reward is not available.' }, { status: 404 });
      const devCode = await sendRedeemCode(env, memberId, item);
      return Response.json(devCode ? { ok: true, devCode } : { ok: true });
    }
    const r = await redeem(env, memberId, String(b.itemId || ''), { key: b.key, code: b.code, network: b.network, phone: b.phone, eventId: b.eventId, notes: b.notes });
    if (!r.ok) return Response.json({ error: r.error, needCode: !!r.needCode }, { status: r.status || 400 });
    return Response.json({ ok: true, redemption: r.redemption });
  } catch (err) {
    console.error('[rewards] redeem', err);
    return Response.json({ error: 'Something went wrong. No points were used. Please try again.' }, { status: 500 });
  }
}
