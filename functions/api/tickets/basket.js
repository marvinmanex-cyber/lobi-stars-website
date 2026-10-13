import { catalogue, holdLineStatement, newBasketIds, ensureTicketShopSchema, fulfilBasket } from '../_lib/ticketShop.js';
import { priceBasket } from '../_lib/tickets/rules.js';
import { initialize, verify } from '../_lib/paystackClient.js';
import { normalizeNigerianPhone, clientIp, rateLimit, tooMany, checkTurnstile, ensureFanSchema } from '../_lib/fans.js';
import { readSession } from '../_lib/session.js';
import { membershipOf } from '../_lib/membership.js';
import { seasonConfig } from '../_lib/seasonConfig.js';

// POST /api/tickets/basket { lines: [{ eventId, tier, quantity }], buyerName, buyerEmail, buyerPhone, turnstileToken }
//   One payment for tickets to one or several home matches. Prices come from
//   the server; seats are held atomically (sold-out lines are refused by name).
//   -> { authorizationUrl, reference }
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

    const cat = await catalogue(env);
    const priced = priceBasket(Array.isArray(b.lines) ? b.lines.map(l => ({ eventId: String(l.eventId || ''), tier: String(l.tier || ''), quantity: Number(l.quantity) })) : [], cat);
    if (!priced.ok) return Response.json({ error: priced.error, eventId: priced.eventId || null, soldOut: !!priced.soldOut }, { status: priced.soldOut ? 409 : 400 });

    // Members' priority window (same rule as single tickets).
    const early = priced.lines.filter(l => { const e = cat.get(l.eventId).event; return e.public_sale_at && Date.now() < Date.parse(e.public_sale_at); });
    if (early.length) {
      const memberId = await readSession(request, env.SESSION_SECRET);
      const m = memberId ? await membershipOf(db, memberId, (await seasonConfig(env, request)).currentSeason) : null;
      if (!m?.active) {
        const e = cat.get(early[0].eventId).event;
        return Response.json({ error: `${e.home_team} vs ${e.away_team} is in the members' priority window. Members: please log in first.`, eventId: e.id, code: 'members_only' }, { status: 403 });
      }
    }

    // Hold the seats: every line in one batch; a line that no longer fits inserts nothing.
    const { basketId, reference } = newBasketIds();
    const buyer = { name, email, phone };
    await db.prepare(`INSERT INTO league_ticket_orders (id, reference, buyer_name, buyer_email, buyer_phone, total_kobo) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(basketId, reference, name, email, phone, priced.totalKobo).run();
    const lineIds = priced.lines.map((l, i) => ({ ...l, orderId: `${basketId}-${i + 1}`, lineRef: `${reference}-${i + 1}` }));
    const res = await db.batch(lineIds.map(l => holdLineStatement(db, { orderId: l.orderId, basketId, eventId: l.eventId, tier: l.tier, quantity: l.quantity, unitKobo: l.unitKobo, buyer, reference: l.lineRef })));
    const failed = lineIds.filter((l, i) => !res[i].meta.changes);
    if (failed.length) {
      await db.batch([
        db.prepare(`DELETE FROM orders WHERE basket_id = ?`).bind(basketId),
        db.prepare(`UPDATE league_ticket_orders SET status = 'failed' WHERE id = ?`).bind(basketId),
      ]);
      const f = failed[0], e = cat.get(f.eventId).event;
      return Response.json({ error: `Sorry, ${e.home_team} vs ${e.away_team} (${f.tier === 'VIP' ? 'VIP Sitting' : f.tier === 'Premium' ? 'Cover Stand' : 'Popular Stand'}) has just sold out. Remove it and pay for the rest.`, eventId: f.eventId, tier: f.tier, soldOut: true }, { status: 409 });
    }

    const origin = new URL(request.url).origin;
    try {
      const p = await initialize(env, { email, amountKobo: priced.totalKobo, reference, callbackUrl: `${origin}/tickets/success/?basket=${encodeURIComponent(reference)}`, metadata: { kind: 'basket', basketId, matches: priced.lines.length } });
      return Response.json({ authorizationUrl: p.authorization_url, reference });
    } catch (err) {
      await db.batch([
        db.prepare(`UPDATE orders SET payment_status = 'failed' WHERE basket_id = ?`).bind(basketId),
        db.prepare(`UPDATE league_ticket_orders SET status = 'failed' WHERE id = ?`).bind(basketId),
      ]);
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
    const reference = new URL(request.url).searchParams.get('reference') || '';
    if (!/^LSBAS-[A-Z0-9]{6,20}$/.test(reference)) return Response.json({ error: 'Missing reference' }, { status: 400 });
    let basket = await db.prepare(`SELECT * FROM league_ticket_orders WHERE reference = ?`).bind(reference).first();
    if (!basket) return Response.json({ error: 'Order not found' }, { status: 404 });
    if (basket.status === 'pending') {
      try {
        const t = await verify(env, reference);
        if (t.status === 'success' && t.amount === basket.total_kobo && (t.currency || 'NGN') === 'NGN') await fulfilBasket(env, basket, waitUntil);
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
  const { results } = await db.prepare(`SELECT o.id AS order_id, o.tier, o.quantity, o.event_id, e.home_team, e.away_team, e.event_date, e.venue,
      (SELECT id FROM league_fixtures f WHERE f.event_id = o.event_id) AS fixture_id
    FROM orders o JOIN events e ON e.id = o.event_id WHERE o.basket_id = ? AND o.payment_status = 'paid' ORDER BY e.event_date`).bind(basket.id).all();
  const matches = [];
  for (const r of results) {
    const { results: t } = await db.prepare(`SELECT id, status FROM tickets WHERE order_id = ? ORDER BY id`).bind(r.order_id).all();
    matches.push({ eventId: r.event_id, homeTeam: r.home_team, awayTeam: r.away_team, kickoff: r.event_date, venue: r.venue, tier: r.tier, fixtureId: r.fixture_id, tickets: t.map(x => ({ id: x.id, status: x.status })) });
  }
  return { reference: basket.reference, email: basket.buyer_email, totalKobo: basket.total_kobo, refunded: basket.status === 'refunded', matches };
}
