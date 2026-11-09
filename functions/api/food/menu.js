import { publicMenu, orderingState } from '../_lib/foodMenuDb.js';
import { foodSettings, popularItems } from '../_lib/foodOrders.js';
import { activeVenueId } from '../_lib/kitchenOps.js';
import { partnerList } from '../_lib/partnerList.js';
import { goalDeal } from '../_lib/goalDeal.js';
import { slotsFor, checkoutMatchId } from '../_lib/halftimeSlots.js';
import { payTransferOn } from '../_lib/payTransfer.js';

// GET /api/food/menu -- the public in-seat food menu (only available items,
// grouped by category), whether ordering is open, and the seat form options.
// Not cached, so menu changes in the admin show straight away.
const todayMatch = env => env.DB.prepare(`SELECT id, event_date FROM events WHERE active = 1 AND home_team LIKE '%Lobi Stars%' AND event_date BETWEEN ? AND ? LIMIT 1`)
  .bind(new Date(Date.now() - 4 * 3600e3).toISOString(), new Date(Date.now() + 6 * 3600e3).toISOString()).first().catch(() => null);
export async function onRequestGet({ env, request }) {
  const settings = await foodSettings(env.DB);
  const venueId = await activeVenueId(env.DB, new URL(request.url).searchParams.get('venue'));
  // ?lite=1: only "open?" and "home match today?" (the site-wide "Kitchen open" reminder), cached briefly.
  if (new URL(request.url).searchParams.get('lite') === '1') {
    const [state, today] = await Promise.all([orderingState(env, settings, venueId), todayMatch(env)]);
    return Response.json({ open: state.open, matchday: !!today, kickOff: today?.event_date || null }, { headers: { 'Cache-Control': 'public, max-age=120' } });
  }
  const [categories, state, popular, today] = await Promise.all([publicMenu(env.DB, venueId), orderingState(env, settings, venueId), popularItems(env.DB).catch(() => []),
    // A Lobi Stars home match from 6 hours before kick-off to 4 hours after.
    todayMatch(env)]);
  // Sponsored dishes: the partner's name and logo.
  const partners = await partnerList(env, request.url);
  for (const c of categories) for (const i of c.items) {
    const p = i.sponsor ? partners.find(x => x.slug === i.sponsor) : null;
    i.sponsor = p ? { slug: p.slug, name: p.name, logo: p.logo || null } : null;
  }
  return Response.json({
    open: state.open, reason: state.reason, message: state.message || null, venueId, match: state.match || null, opensAt: state.opensAt || null, closesAt: state.closesAt || null,
    categories, stands: settings.stands, minOrderKobo: settings.minOrderKobo, paymentExpiryMinutes: settings.paymentExpiryMinutes,
    pickupPoints: settings.pickupPoints,
    matchday: !!today,
    popular, // the most ordered dishes ("Popular now" at the top of the menu)
    payTransfer: await payTransferOn(env.DB),
    halftimeSlots: today ? await slotsFor(env.DB, await checkoutMatchId(env.DB)).then(l => l.map(s => ({ id: s.id, label: s.label, at: s.at, left: s.left, full: s.full }))).catch(() => []) : [],
    goalDeal: await goalDeal(env.DB).then(d => (d.activeUntil ? { percent: d.percent, until: d.activeUntil } : null)).catch(() => null),
    whatsapp: settings.whatsappEnabled ? { number: settings.whatsappNumber, display: `+${settings.whatsappNumber.slice(0, 3)} ${settings.whatsappNumber.slice(3, 6)} ${settings.whatsappNumber.slice(6, 9)} ${settings.whatsappNumber.slice(9)}` } : null,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
