import { catalogue } from '../_lib/ticketShop.js';
import { priceBasket } from '../_lib/tickets/rules.js';
import { clientIp, rateLimit, tooMany, ensureFanSchema } from '../_lib/fans.js';
import { ensureDiscountSchema, priceWithDiscounts, parseBuyerLines, publicPricing } from '../_lib/ticketDiscounts.js';
import { plainPricing } from '../_lib/ticketing/engineOrders.js';

// POST /api/tickets/price { lines, buyerEmail? } -- the live order summary on
// /tickets: subtotal, the discount that applies (and why), the total, and a
// nudge when close to a group tier. Same server-side function as checkout
// (computeOrderPricing); nothing is saved or held. Rate-limited.
export async function onRequestPost({ request, env }) {
  try {
    const db = env.DB;
    await ensureFanSchema(db);
    if (!(await rateLimit(db, `ticket-price:${clientIp(request)}`, 240, 3600))) return tooMany();
    const b = await request.json().catch(() => ({}));
    await ensureDiscountSchema(db);
    const { lines, rawByKey } = parseBuyerLines(b.lines);
    const cat = await catalogue(env);
    const priced = priceBasket(lines, cat);
    if (!priced.ok) return Response.json({ ok: false, error: priced.error, eventId: priced.eventId || null }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    // Ticketing engine mode: the engine's prices, no local discounts (the engine charges what it prices).
    if (cat.engine) {
      if ([...rawByKey.values()].some(r => r.family)) return Response.json({ ok: false, error: 'Family and child tickets cannot be bought online for this match yet. Choose adult tickets.' }, { headers: { 'Cache-Control': 'no-store' } });
      return Response.json(plainPricing(priced), { headers: { 'Cache-Control': 'no-store' } });
    }
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(b.buyerEmail || '').trim()) ? String(b.buyerEmail).trim().toLowerCase() : '';
    const { pricing } = await priceWithDiscounts(db, priced.lines, rawByKey, cat, email);
    if (!pricing.ok) return Response.json({ ok: false, error: pricing.error, eventId: pricing.eventId || null }, { headers: { 'Cache-Control': 'no-store' } });
    return Response.json({ ok: true, ...publicPricing(pricing) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[tickets] price', err);
    return Response.json({ ok: false, error: 'Could not work out the price just now.' }, { status: 500 });
  }
}
