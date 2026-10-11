import { publicMenu, orderingState } from '../_lib/foodMenuDb.js';
import { foodSettings } from '../_lib/foodOrders.js';

// GET /api/food/menu -- the public in-seat food menu (only available items,
// grouped by category), whether ordering is open, and the seat form options.
// Not cached, so menu changes in the admin show straight away.
export async function onRequestGet({ env }) {
  const settings = await foodSettings(env.DB);
  const [categories, state] = await Promise.all([publicMenu(env.DB), orderingState(env, settings)]);
  return Response.json({
    open: state.open, reason: state.reason, match: state.match || null,
    categories, stands: settings.stands, minOrderKobo: settings.minOrderKobo, paymentExpiryMinutes: settings.paymentExpiryMinutes,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
