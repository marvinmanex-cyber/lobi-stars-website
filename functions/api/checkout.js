import { randomId } from './_lib/crypto.js';
import { initializeTransaction } from './_lib/paystack.js';
import { ensureTable } from './_lib/matchCentre.js';
import { readSession } from './_lib/session.js';
import { membershipOf } from './_lib/membership.js';
import { seasonConfig } from './_lib/seasonConfig.js';
import { catalogue, holdLineStatement } from './_lib/ticketShop.js';
import { priceBasket } from './_lib/tickets/rules.js';

const TIER_COLUMN = {
  VIP: 'vip_price_kobo',
  Premium: 'premium_price_kobo',
  Regular: 'regular_price_kobo',
};

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { eventId, tier, quantity, buyerName, buyerEmail, buyerPhone } = body || {};

  if (!eventId || !tier || !TIER_COLUMN[tier] || !buyerName || !buyerEmail || !buyerPhone) {
    return Response.json({ error: 'Missing or invalid required fields' }, { status: 400 });
  }
  const qty = Number.parseInt(quantity, 10);
  if (!Number.isInteger(qty) || qty < 1 || qty > 10) {
    return Response.json({ error: 'Quantity must be between 1 and 10' }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
    return Response.json({ error: 'Invalid email address' }, { status: 400 });
  }

  await ensureTable(env.DB);
  const event = await env.DB.prepare(
    `SELECT id, home_team, away_team, event_date, public_sale_at, ${TIER_COLUMN[tier]} AS unit_price_kobo
     FROM events WHERE id = ? AND active = 1`
  ).bind(eventId).first();

  if (!event) {
    return Response.json({ error: 'Event not found or no longer on sale' }, { status: 404 });
  }

  // Members' priority window: until general sale opens, only confirmed members can buy.
  if (event.public_sale_at && Date.now() < Date.parse(event.public_sale_at)) {
    const memberId = await readSession(request, env.SESSION_SECRET);
    const m = await membershipOf(env.DB, memberId, (await seasonConfig(env, request)).currentSeason);
    if (!m?.active) {
      const opens = new Date(event.public_sale_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
      return Response.json({
        error: memberId
          ? `Tickets for this match are in the members' priority window. General sale opens ${opens}.`
          : `Tickets for this match are in the members' priority window. Members: please log in first. General sale opens ${opens}.`,
        code: 'members_only',
      }, { status: 403 });
    }
  }

  // Same rules as the Tickets page: on/off switch, sale times, home matches only, seats left.
  const priced = priceBasket([{ eventId: String(eventId), tier, quantity: qty }], await catalogue(env));
  if (!priced.ok) return Response.json({ error: priced.error, soldOut: !!priced.soldOut }, { status: priced.soldOut ? 409 : 400 });

  const unitPriceKobo = priced.lines[0].unitKobo;
  const totalKobo = unitPriceKobo * qty;
  const orderId = randomId('LS-ORD');
  const reference = randomId('LSPAY');

  // Holds the seats only if they still fit (one statement: no overselling).
  const held = await holdLineStatement(env.DB, { orderId, basketId: null, eventId, tier, quantity: qty, unitKobo: unitPriceKobo, buyer: { name: String(buyerName).slice(0, 80), email: buyerEmail, phone: buyerPhone }, reference }).run();
  if (!held.meta.changes) return Response.json({ error: 'Sorry, that stand has just sold out.', soldOut: true }, { status: 409 });

  const origin = new URL(request.url).origin;

  let paystack;
  try {
    paystack = await initializeTransaction(env.PAYSTACK_SECRET_KEY, {
      email: buyerEmail,
      amountKobo: totalKobo,
      reference,
      callbackUrl: `${origin}/tickets/success`,
      metadata: { orderId, eventId, tier, quantity: qty },
    });
  } catch (err) {
    return Response.json({ error: `Payment initialization failed: ${err.message}` }, { status: 502 });
  }

  return Response.json({
    authorizationUrl: paystack.authorization_url,
    reference,
    orderId,
  });
}
