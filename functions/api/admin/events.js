import { randomId } from '../_lib/crypto.js';
import { requireAdmin, parseEventPayload } from '../_lib/adminEvents.js';

// GET /api/admin/events -- every match, past and future, active or not,
// with a sold-ticket count so the UI can warn before deleting. Auth: the
// x-admin-code header must match the ADMIN_CODE secret.
export async function onRequestGet({ request, env }) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;

  const { results } = await env.DB.prepare(
    `SELECT e.*,
            (SELECT COUNT(*) FROM orders o WHERE o.event_id = e.id AND o.payment_status = 'paid') AS paid_orders
     FROM events e
     ORDER BY e.event_date DESC`
  ).all();

  return Response.json({ events: results });
}

// POST /api/admin/events -- create a new match.
export async function onRequestPost({ request, env }) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = parseEventPayload(body);
  if (parsed.error) return Response.json({ error: parsed.error }, { status: 400 });
  const e = parsed.value;

  const id = randomId('evt', 10);
  await env.DB.prepare(
    `INSERT INTO events
       (id, home_team, away_team, competition, event_date, venue,
        vip_price_kobo, premium_price_kobo, regular_price_kobo, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, e.home_team, e.away_team, e.competition, e.event_date, e.venue,
    e.vip_price_kobo, e.premium_price_kobo, e.regular_price_kobo, e.active
  ).run();

  return Response.json({ ok: true, id });
}
