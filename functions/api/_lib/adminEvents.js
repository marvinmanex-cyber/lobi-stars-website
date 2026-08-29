// Shared helpers for the protected match-management endpoints under
// /api/admin/events. Access is gated by a single shared passcode kept in
// the ADMIN_CODE server secret -- the same lightweight pattern the gate
// scanner uses with STAFF_SCAN_CODE, but a separate code so match editing
// and ticket scanning can be handed to different people.

export function requireAdmin(request, env) {
  if (!env.ADMIN_CODE) {
    return Response.json(
      { error: 'Admin access is not configured. Set ADMIN_CODE in the server environment.' },
      { status: 503 }
    );
  }
  const code = request.headers.get('x-admin-code') || '';
  // Length check first so the comparison below isn't the only gate; still
  // not truly constant-time, but the codebase treats these codes as
  // low-value shared secrets rather than password hashes.
  if (code.length !== env.ADMIN_CODE.length || code !== env.ADMIN_CODE) {
    return Response.json({ error: 'Invalid admin code' }, { status: 401 });
  }
  return null;
}

// Validates and normalises a match payload from the admin UI. Returns
// { value } on success or { error } with a human-readable message.
export function parseEventPayload(body) {
  const b = body || {};
  const str = v => (typeof v === 'string' ? v.trim() : '');

  const home_team = str(b.home_team);
  const away_team = str(b.away_team);
  const competition = str(b.competition) || 'NNL Conference D';
  const venue = str(b.venue);
  const event_date = str(b.event_date);

  if (!home_team || !away_team || !venue || !event_date) {
    return { error: 'Home team, away team, venue and date are all required.' };
  }

  const parsed = new Date(event_date);
  if (Number.isNaN(parsed.getTime())) {
    return { error: 'Date is not a valid date/time.' };
  }

  const prices = {
    vip_price_kobo: toKobo(b.vip_price_kobo),
    premium_price_kobo: toKobo(b.premium_price_kobo),
    regular_price_kobo: toKobo(b.regular_price_kobo),
  };
  for (const [key, val] of Object.entries(prices)) {
    if (val === null) return { error: `${key.replace(/_/g, ' ')} must be a whole number of kobo (0 or more).` };
  }

  return {
    value: {
      home_team,
      away_team,
      competition,
      venue,
      event_date: parsed.toISOString(),
      ...prices,
      active: b.active ? 1 : 0,
    },
  };
}

function toKobo(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}
