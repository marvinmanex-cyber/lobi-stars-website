// Shared helpers for the protected admin endpoints.
import { getAdmin } from './adminSession.js';

/**
 * Returns null when the request comes from a signed-in admin (the owner's
 * ADMIN_CODE in the x-admin-code header, or a valid staff cookie), otherwise
 * an error Response. Use requireAdminUser() when you need to know who it is.
 */
export async function requireAdmin(request, env) {
  const r = await requireAdminUser(request, env);
  return r.denied || null;
}

export async function requireAdminUser(request, env, { needExport = false, ownerOnly = false } = {}) {
  if (!env.ADMIN_CODE) {
    return { denied: Response.json(
      { error: 'Admin access is not configured. Set ADMIN_CODE in the server environment.' },
      { status: 503 }
    ) };
  }
  const admin = await getAdmin(request, env);
  if (!admin) return { denied: Response.json({ error: 'Invalid admin code' }, { status: 401 }) };
  if (ownerOnly && admin.role !== 'owner') return { denied: Response.json({ error: 'Only the owner account can do this.' }, { status: 403 }) };
  if (needExport && !admin.canExport) return { denied: Response.json({ error: 'You do not have permission to export fan data.' }, { status: 403 }) };
  return { admin };
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
  const programme_url = str(b.programme_url).slice(0, 300) || null;
  // Lobi Stars FC Live: commentary on by default; start time blank = 15 minutes before kick-off.
  const commentary_enabled = b.commentary_enabled === false ? 0 : 1;
  let commentary_start_at = null;
  if (str(b.commentary_start_at)) {
    const cs = new Date(str(b.commentary_start_at));
    if (Number.isNaN(cs.getTime())) return { error: 'Commentary start time is not a valid date/time.' };
    commentary_start_at = cs.toISOString();
  }

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
      programme_url,
      // null = decide from the home team name; true/false = set by staff.
      is_home: b.is_home === true ? 1 : b.is_home === false ? 0 : null,
      commentary_enabled,
      commentary_start_at,
    },
  };
}

function toKobo(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}
