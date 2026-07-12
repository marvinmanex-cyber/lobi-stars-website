// POST /api/validate-ticket -- called from the /scan gate page. Atomically
// flips a ticket from valid -> used so two doors scanning the same ticket
// at the same instant can't both admit it.
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
