import { requireAdmin, parseEventPayload } from '../../_lib/adminEvents.js';
import { ensureTable } from '../../_lib/matchCentre.js';
import { ensureCommentarySchema } from '../../_lib/commentary.js';

// PUT /api/admin/events/:id -- overwrite a match's details.
export async function onRequestPut({ request, env, params }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  await ensureTable(env.DB);
  const id = (params.id || '').trim();
  const existing = await env.DB.prepare(`SELECT id FROM events WHERE id = ?`).bind(id).first();
  if (!existing) return Response.json({ error: 'Match not found' }, { status: 404 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = parseEventPayload(body);
  if (parsed.error) return Response.json({ error: parsed.error }, { status: 400 });
  const e = parsed.value;

  await ensureCommentarySchema(env.DB);
  await env.DB.prepare(
    `UPDATE events SET
       home_team = ?, away_team = ?, competition = ?, event_date = ?, venue = ?,
       vip_price_kobo = ?, premium_price_kobo = ?, regular_price_kobo = ?, active = ?,
       programme_url = ?, is_home = ?, commentary_enabled = ?, commentary_start_at = ?
     WHERE id = ?`
  ).bind(
    e.home_team, e.away_team, e.competition, e.event_date, e.venue,
    e.vip_price_kobo, e.premium_price_kobo, e.regular_price_kobo, e.active, e.programme_url, e.is_home,
    e.commentary_enabled, e.commentary_start_at, id
  ).run();

  return Response.json({ ok: true });
}

// DELETE /api/admin/events/:id -- only allowed while no tickets have been
// sold. Once there are paid orders the match must stay for ticket lookups
// and gate scans, so callers should set it inactive instead.
export async function onRequestDelete({ request, env, params }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const id = (params.id || '').trim();
  const existing = await env.DB.prepare(`SELECT id FROM events WHERE id = ?`).bind(id).first();
  if (!existing) return Response.json({ error: 'Match not found' }, { status: 404 });

  const orders = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM orders WHERE event_id = ?`
  ).bind(id).first();
  if (orders.n > 0) {
    return Response.json(
      { error: 'This match already has orders against it. Set it inactive instead of deleting.' },
      { status: 409 }
    );
  }

  await env.DB.prepare(`DELETE FROM events WHERE id = ?`).bind(id).run();
  return Response.json({ ok: true });
}
