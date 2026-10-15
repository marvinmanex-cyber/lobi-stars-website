import { readSession } from '../_lib/session.js';
import { qrPngBuffer } from '../_lib/qrcode.js';
import { ensureRewardsSchema, rewardsMember, memberNo } from '../_lib/rewards.js';
import { ensureCatalogueSchema } from '../_lib/rewardsCatalogue.js';
import { cardCode } from '../_lib/rewardsBadges.js';

// GET /api/rewards/qr?card=1          -> the signed-in member's card QR (PNG)
// GET /api/rewards/qr?voucher=CODE    -> the QR of one of their own vouchers (PNG)
// Staff scan these at the food stands or the club shop (Admin › Rewards ›
// Fulfilment & Vouchers). The member card holds no personal data.
export async function onRequestGet({ request, env }) {
  const memberId = await readSession(request, env.SESSION_SECRET).catch(() => null);
  if (!memberId) return new Response('Please log in', { status: 401 });
  const db = env.DB;
  await ensureRewardsSchema(db);
  const url = new URL(request.url);
  let text = null;
  if (url.searchParams.get('card')) {
    const m = await rewardsMember(db, memberId);
    if (m) text = await cardCode(env, memberNo(m.seq));
  } else {
    await ensureCatalogueSchema(db);
    const code = String(url.searchParams.get('voucher') || '').trim().toUpperCase();
    const v = await db.prepare(`SELECT voucher_code FROM rewards_redemptions WHERE voucher_code = ? AND member_id = ?`).bind(code, memberId).first();
    if (v) text = v.voucher_code;
  }
  if (!text) return new Response('Not found', { status: 404 });
  return new Response(await qrPngBuffer(text), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' } });
}
