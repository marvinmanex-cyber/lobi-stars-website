import { catalogue, newBasketIds, ensureTicketShopSchema, fulfilBasket } from '../_lib/ticketShop.js';
import { priceBasket, naira, TIER_LABELS } from '../_lib/tickets/rules.js';
import { initialize, verify } from '../_lib/paystackClient.js';
import { normalizeNigerianPhone, clientIp, rateLimit, tooMany, checkTurnstile, ensureFanSchema } from '../_lib/fans.js';
import { readSession } from '../_lib/session.js';
import { membershipOf } from '../_lib/membership.js';
import { seasonConfig } from '../_lib/seasonConfig.js';
import { presaleMs } from '../_lib/rewardsTiers.js';
import { holdCheckoutRewards, releaseCheckout, ensureCheckoutColumns } from '../_lib/rewardsCheckout.js';
import { ensureDiscountSchema, priceWithDiscounts, orderChunks, holdChunkStatement, parseBuyerLines, publicPricing, lockedTotalOk } from '../_lib/ticketDiscounts.js';

// POST /api/tickets/basket { lines: [{ eventId, tier, quantity } | { eventId, tier, family: true, adults, children }],
//   groupName, expectedTotalKobo, buyerName, buyerEmail, buyerPhone, turnstileToken }
//   One payment for tickets to one or several home matches. Prices AND
//   discounts come from the server (computeOrderPricing, server clock); any
//   price sent by the browser is ignored. Seats and discounted tickets are
//   held atomically. If the total differs from expectedTotalKobo (what the
//   buyer was shown), nothing is charged: 409 with the new price, so the buyer
//   sees it first. -> { authorizationUrl, reference }
// GET /api/tickets/basket?reference=  -- after paying: confirms with Paystack
//   (if the webhook hasn't arrived yet) and returns the tickets per match.
const clean = (v, max) => String(v ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);

export async function onRequestPost({ request, env }) {
  try {
    const db = env.DB;
    await ensureFanSchema(db);
    const ip = clientIp(request);
    if (!(await rateLimit(db, `ticket-basket:${ip}`, 12, 3600))) return tooMany();
    const b = await request.json().catch(() => ({}));
    const name = clean(b.buyerName, 80), email = String(b.buyerEmail || '').trim().toLowerCase(), phone = normalizeNigerianPhone(b.buyerPhone);
    if (name.length < 2) return Response.json({ error: 'Please enter your full name.' }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) return Response.json({ error: 'Please enter a valid email address.' }, { status: 400 });
    if (!phone) return Response.json({ error: 'Please enter a valid Nigerian mobile number, e.g. 0803 123 4567.' }, { status: 400 });
    if (!(await checkTurnstile(env, b.turnstileToken, ip))) return Response.json({ error: 'Please complete the human check and try again.' }, { status: 400 });

    await ensureDiscountSchema(db);
    const { lines: buyerLines, rawByKey } = parseBuyerLines(b.lines);
    const groupName = clean(b.groupName, 80);
    // Early ticket access for signed-in Gold/Star Rewards members (presale), also in the members' priority window.
    const sessionId = await readSession(request, env.SESSION_SECRET).catch(() => null);
    const earlyMs = await presaleMs(db, sessionId);
    let cat = await catalogue(env, { earlyMs });
    const priced = priceBasket(buyerLines, cat);
    if (!priced.ok) return Response.json({ error: priced.error, eventId: priced.eventId || null, soldOut: !!priced.soldOut }, { status: priced.soldOut ? 409 : 400 });
    const { pricing, input } = await priceWithDiscounts(db, priced.lines, rawByKey, cat, email);
    if (!pricing.ok) return Response.json({ error: pricing.error, eventId: pricing.eventId || null }, { status: 400 });
    const expected = b.expectedTotalKobo === undefined || b.expectedTotalKobo === null ? null : Number(b.expectedTotalKobo);
    if (expected !== null && expected !== pricing.totalKobo) {
      return Response.json({ code: 'repriced', error: `The price has changed to ${naira(pricing.totalKobo)}. Check your order and press Pay again.`, pricing: publicPricing(pricing) }, { status: 409 });
    }

    // Members' priority window (same rule as single tickets).
    const early = priced.lines.filter(l => { const e = cat.get(l.eventId).event; return e.public_sale_at && Date.now() < Date.parse(e.public_sale_at) - earlyMs; });
    if (early.length) {
      const memberId = sessionId;
      const m = memberId ? await membershipOf(db, memberId, (await seasonConfig(env, request)).currentSeason) : null;
      if (!m?.active) {
        const e = cat.get(early[0].eventId).event;
        return Response.json({ error: `${e.home_team} vs ${e.away_team} is in the members' priority window. Members: please log in first.`, eventId: e.id, code: 'members_only' }, { status: 403 });
      }
    }

    // The basket, with the discount locked in (discount_snapshot_json: the exact
    // rules, settings, clock and allowances used), so reprints and the webhook
    // re-check always give the same numbers.
    const { basketId, reference } = newBasketIds();
    const buyer = { name, email, phone };
    // Lobi Stars Rewards: "Use my Star Points" (held now, taken when Paystack confirms).
    await ensureCheckoutColumns(db);
    const pay = await holdCheckoutRewards(env, { memberId: sessionId, kind: 'tickets', subtotalKobo: pricing.totalKobo, usePoints: b.usePoints, reference });
    if (pay.error) return Response.json({ error: pay.error }, { status: 400 });
    const groupApplied = pricing.applied.some(a => a.kind === 'group');
    await db.prepare(`INSERT INTO league_ticket_orders (id, reference, buyer_name, buyer_email, buyer_phone, total_kobo, subtotal_kobo, discount_kobo, discount_rule_id, discount_label, discount_snapshot_json, group_name, points_used, points_kobo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(basketId, reference, name, email, phone, pay.totalKobo, pricing.subtotalKobo, pricing.discountKobo, pricing.applied[0]?.ruleId || null, pricing.label || null,
        pricing.discountKobo ? JSON.stringify(input) : null, groupApplied && groupName ? groupName : null, pay.pointsUsed, pay.pointsKobo).run();

    // Hold the seats and discounted tickets: every row in one batch; a row that no longer fits inserts nothing.
    const chunks = orderChunks(pricing, priced.lines);
    const res = await db.batch(chunks.map((c, i) => holdChunkStatement(db, { orderId: `${basketId}-${i + 1}`, basketId, reference: `${reference}-${i + 1}`, buyer, chunk: c })));
    const failed = chunks.filter((c, i) => !res[i].meta.changes);
    if (failed.length) {
      await db.batch([
        db.prepare(`DELETE FROM orders WHERE basket_id = ?`).bind(basketId),
        db.prepare(`UPDATE league_ticket_orders SET status = 'failed' WHERE id = ?`).bind(basketId),
      ]);
      await releaseCheckout(env, reference);
      // Either the seats are gone, or someone else just took the last discounted tickets.
      cat = await catalogue(env, { earlyMs });
      const again = priceBasket(buyerLines, cat);
      if (again.ok) {
        const fresh = (await priceWithDiscounts(db, again.lines, rawByKey, cat, email)).pricing;
        if (fresh.ok && fresh.totalKobo !== pricing.totalKobo) {
          return Response.json({ code: 'repriced', error: `The discount has just run out for some tickets: the price is now ${naira(fresh.totalKobo)}. Check your order and press Pay again.`, pricing: publicPricing(fresh) }, { status: 409 });
        }
      }
      const f = failed[0], e = cat.get(f.eventId).event;
      return Response.json({ error: `Sorry, ${e.home_team} vs ${e.away_team} (${TIER_LABELS[f.tier] || f.tier}) has just sold out. Remove it and pay for the rest.`, eventId: f.eventId, tier: f.tier, soldOut: true }, { status: 409 });
    }

    const origin = new URL(request.url).origin;
    try {
      const p = await initialize(env, { email, amountKobo: pay.totalKobo, reference, callbackUrl: `${origin}/tickets/success/?basket=${encodeURIComponent(reference)}`, metadata: { kind: 'basket', basketId, matches: pricing.matches.length, discount_kobo: pricing.discountKobo } });
      return Response.json({ authorizationUrl: p.authorization_url, reference, totalKobo: pay.totalKobo, pointsUsed: pay.pointsUsed });
    } catch (err) {
      await db.batch([
        db.prepare(`UPDATE orders SET payment_status = 'failed' WHERE basket_id = ?`).bind(basketId),
        db.prepare(`UPDATE league_ticket_orders SET status = 'failed' WHERE id = ?`).bind(basketId),
      ]);
      await releaseCheckout(env, reference);
      return Response.json({ error: 'Payment could not be started. Please try again.' }, { status: 502 });
    }
  } catch (err) {
    console.error('[tickets] basket', err);
    return Response.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    await ensureTicketShopSchema(db);
    await ensureDiscountSchema(db);
    const reference = new URL(request.url).searchParams.get('reference') || '';
    if (!/^LSBAS-[A-Z0-9]{6,20}$/.test(reference)) return Response.json({ error: 'Missing reference' }, { status: 400 });
    let basket = await db.prepare(`SELECT * FROM league_ticket_orders WHERE reference = ?`).bind(reference).first();
    if (!basket) return Response.json({ error: 'Order not found' }, { status: 404 });
    if (basket.status === 'pending') {
      try {
        const t = await verify(env, reference);
        if (t.status === 'success' && t.amount === basket.total_kobo && (t.currency || 'NGN') === 'NGN' && await lockedTotalOk(db, basket)) await fulfilBasket(env, basket, waitUntil);
      } catch (err) { console.error('[tickets] verify', err); }
      basket = await db.prepare(`SELECT * FROM league_ticket_orders WHERE id = ?`).bind(basket.id).first();
    }
    if (basket.status !== 'paid') return Response.json({ paid: false, status: basket.status }, { headers: { 'Cache-Control': 'no-store' } });
    return Response.json({ paid: true, ...(await basketTickets(db, basket)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[tickets] basket status', err);
    return Response.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}

/** The tickets of a basket, per match (only for someone holding the reference). */
export async function basketTickets(db, basket) {
  const { results } = await db.prepare(`SELECT o.id AS order_id, o.tier, o.quantity, o.event_id, o.discount_kobo, e.home_team, e.away_team, e.event_date, e.venue,
      (SELECT id FROM league_fixtures f WHERE f.event_id = o.event_id) AS fixture_id
    FROM orders o JOIN events e ON e.id = o.event_id WHERE o.basket_id = ? AND o.payment_status = 'paid' ORDER BY e.event_date, o.rowid`).bind(basket.id).all();
  // One entry per match and stand (a match can have several rows: adult/child, or more than 10 tickets).
  const matches = [];
  for (const r of results) {
    const { results: t } = await db.prepare(`SELECT id, status, ticket_type FROM tickets WHERE order_id = ? ORDER BY id`).bind(r.order_id).all();
    let m = matches.find(x => x.eventId === r.event_id && x.tier === r.tier);
    if (!m) { m = { eventId: r.event_id, homeTeam: r.home_team, awayTeam: r.away_team, kickoff: r.event_date, venue: r.venue, tier: r.tier, fixtureId: r.fixture_id, tickets: [], discountKobo: 0 }; matches.push(m); }
    m.discountKobo += Number(r.discount_kobo) || 0;
    m.tickets.push(...t.map(x => ({ id: x.id, status: x.status, type: x.ticket_type || 'adult' })));
  }
  return {
    reference: basket.reference, email: basket.buyer_email, totalKobo: basket.total_kobo,
    subtotalKobo: basket.subtotal_kobo ?? basket.total_kobo, discountKobo: basket.discount_kobo || 0, discountLabel: basket.discount_label || null, groupName: basket.group_name || null,
    refunded: basket.status === 'refunded', matches,
  };
}
