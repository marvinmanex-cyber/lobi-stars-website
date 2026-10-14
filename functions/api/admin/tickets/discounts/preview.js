import { ticketAuth, ok, fail, lagosToIso } from '../../../_lib/ticketAdmin.js';
import { loadRules, loadDiscountSettings, discountContext } from '../../../_lib/ticketDiscounts.js';
import { computeOrderPricing } from '../../../_lib/tickets/discounts.js';
import { PRICE_COL, TIER_LABELS } from '../../../_lib/tickets/rules.js';

// POST /api/admin/tickets/discounts/preview { eventId, tier, quantity | family, adults, children, at? }
//   The price the system would charge, with the saved rules (on or off as they
//   are now) and the discounted tickets already used for that match. `at` is a
//   Nigerian date and time to try (default: now). Nothing is saved.
export async function onRequestPost({ request, env }) {
  const { denied } = await ticketAuth(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    const b = await request.json().catch(() => ({}));
    const event = await db.prepare(`SELECT * FROM events WHERE id = ?`).bind(String(b.eventId || '')).first();
    if (!event) return fail('Choose a match.');
    const unit = Number(event[PRICE_COL[b.tier]]) || 0;
    if (!unit) return fail(`${TIER_LABELS[b.tier] || 'That stand'} has no price for this match.`);
    const at = b.at ? lagosToIso(b.at) : new Date().toISOString();
    if (!at || Number.isNaN(at)) return fail('Enter a real date and time.');
    const family = !!b.family;
    const adults = family ? Number(b.adults) : Number(b.quantity), children = family ? Number(b.children) : 0;
    if (!Number.isInteger(adults) || adults < 0 || adults > 500 || !Number.isInteger(children) || children < 0 || children > 20 || adults + children < 1) return fail('Enter how many tickets.');
    const [rules, settings, ctx] = await Promise.all([loadRules(db), loadDiscountSettings(db), discountContext(db, [event.id])]);
    const p = computeOrderPricing([{ eventId: event.id, tier: b.tier, unitKobo: unit, kickoff: event.event_date, family, adults, children, allowDiscounts: ctx[event.id].allowDiscounts }], rules, settings, Date.parse(at), ctx);
    if (!p.ok) return fail(p.error);
    const m = p.matches[0];
    return ok({ at, subtotalKobo: m.subtotalKobo, discountKobo: m.discountKobo, totalKobo: m.totalKobo, label: m.label, reason: m.reason, nudge: m.nudge?.text || null, discountedQty: m.discountedQty, tickets: m.tickets.length, allowDiscounts: ctx[event.id].allowDiscounts });
  } catch (err) {
    console.error('[discounts admin] preview', err);
    return fail('Could not work out the price.', 500);
  }
}
