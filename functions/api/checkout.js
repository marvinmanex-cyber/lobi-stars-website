import { randomId } from './_lib/crypto.js';
import { initializeTransaction } from './_lib/paystack.js';
import { ensureTable } from './_lib/matchCentre.js';
import { readSession } from './_lib/session.js';
import { membershipOf } from './_lib/membership.js';
import { seasonConfig } from './_lib/seasonConfig.js';

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
          ? `Tickets for this match are in the members' priority window. General sale opens ${opens} WAT.`
          : `Tickets for this match are in the members' priority window. Members: please log in first. General sale opens ${opens} WAT.`,
        code: 'members_only',
      }, { status: 403 });
    }
  }

  const unitPriceKobo = event.unit_price_kobo;
  const totalKobo = unitPriceKobo * qty;
  const orderId = randomId('LS-ORD');
  const reference = randomId('LSPAY');

  await env.DB.prepare(
    `INSERT INTO orders (id, event_id, buyer_name, buyer_email, buyer_phone, tier, quantity, unit_price_kobo, total_kobo, paystack_reference, payment_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
  ).bind(orderId, eventId, buyerName, buyerEmail, buyerPhone, tier, qty, unitPriceKobo, totalKobo, reference).run();

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
