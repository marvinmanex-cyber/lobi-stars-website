// POST /api/validate-ticket -- called from the /scan gate page. Atomically
// flips a ticket from valid -> used so two doors scanning the same ticket
// at the same instant can't both admit it.
import { scanSeasonPass } from './_lib/seasonTickets.js';

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ valid: false, reason: 'Invalid request' }, { status: 400 });
  }

  const { ticketId, staffCode, station } = body || {};

  if (!staffCode || staffCode !== env.STAFF_SCAN_CODE) {
    return Response.json({ valid: false, reason: 'Invalid staff code' }, { status: 401 });
  }
  if (!ticketId || typeof ticketId !== 'string') {
    return Response.json({ valid: false, reason: 'No ticket code provided' }, { status: 400 });
  }

  const cleanId = ticketId.trim();

  // Season tickets (LS-SZN-…): once per home match, on a match day.
  if (/^LS-SZN-/i.test(cleanId)) {
    const r = await scanSeasonPass(env.DB, cleanId.toUpperCase(), station);
    return Response.json(r.body, { status: r.status });
  }

  // A match ticket only gets in on the day of its own match (Nigerian time):
  // a ticket for another fixture is refused and stays valid for its match.
  const forMatch = await env.DB.prepare(
    `SELECT t.status, e.home_team, e.away_team, e.event_date FROM tickets t JOIN events e ON e.id = t.event_id WHERE t.id = ?`
  ).bind(cleanId).first();
  if (forMatch && forMatch.status === 'valid' && lagosDay(forMatch.event_date) !== lagosDay(Date.now())) {
    return Response.json({
      valid: false,
      reason: `Wrong match: this ticket is for ${forMatch.home_team} v ${forMatch.away_team} on ${matchDate(forMatch.event_date)}`,
    }, { status: 409 });
  }

  const claim = await env.DB.prepare(
    `UPDATE tickets SET status = 'used', used_at = datetime('now'), scanned_by = ?
     WHERE id = ? AND status = 'valid'`
  ).bind(station || 'unknown', cleanId).run();

  if (claim.meta.changes) {
    const ticket = await env.DB.prepare(
      `SELECT t.id, t.tier, o.buyer_name, e.home_team, e.away_team, e.event_date, e.venue
       FROM tickets t
       JOIN orders o ON o.id = t.order_id
       JOIN events e ON e.id = t.event_id
       WHERE t.id = ?`
    ).bind(cleanId).first();

    return Response.json({ valid: true, ticket });
  }

  // Not updated -- figure out why, for a clear message at the gate.
  const existing = await env.DB.prepare(`SELECT status, used_at FROM tickets WHERE id = ?`).bind(cleanId).first();

  if (!existing) {
    return Response.json({ valid: false, reason: 'Ticket not found' }, { status: 404 });
  }
  if (existing.status === 'used') {
    return Response.json({ valid: false, reason: `Already used at ${existing.used_at}` }, { status: 409 });
  }
  return Response.json({ valid: false, reason: 'Ticket void' }, { status: 409 });
}

// Calendar day in Nigeria (UTC+1), e.g. '2026-10-12'.
const lagosDay = d => new Date(new Date(d).getTime() + 3600e3).toISOString().slice(0, 10);
const matchDate = d => new Date(d).toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
