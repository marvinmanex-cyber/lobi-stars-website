import { requireAdmin, requireAdminUser, parseEventPayload } from '../../_lib/adminEvents.js';
import { can } from '../../_lib/adminRoles.js';

const FIXTURE = 'matchday.fixtures.edit|matchday.live_control';
import { ensureTable } from '../../_lib/matchCentre.js';
import { ensureCommentarySchema } from '../../_lib/commentary.js';
import { leagueFixtureForEvent } from '../../_lib/leagueDb.js';
import { syncChecklistsQuietly } from '../../_lib/matchChecklist.js';

// PUT /api/admin/events/:id -- overwrite a match's details.
// Each part needs its own permission and parts you can't change are kept:
// teams, date, venue and on/off sale (fixtures), ticket prices and sale time
// (tickets), commentary on/off and start time (broadcast).
export async function onRequestPut({ request, env, params }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;

  await ensureTable(env.DB);
  await ensureCommentarySchema(env.DB);
  const id = (params.id || '').trim();
  const existing = await env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(id).first();
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
  const keep = keys => { for (const k of keys) if (k in existing) e[k] = existing[k]; };
  if (!can(admin, FIXTURE)) keep(['home_team', 'away_team', 'competition', 'event_date', 'venue', 'is_home', 'programme_url']);
  if (!can(admin, `${FIXTURE}|commerce.tickets.manage`)) keep(['active']);
  if (!can(admin, 'commerce.tickets.manage')) keep(['vip_price_kobo', 'premium_price_kobo', 'regular_price_kobo', 'public_sale_at']);
  if (!can(admin, 'broadcast.commentary.manage|settings.commentary')) keep(['commentary_enabled', 'commentary_start_at']);

  // A Lobi Stars league match: its teams, date, time and venue come from
  // League > Fixtures (prices, commentary and sale settings are still set here).
  const league = await leagueFixtureForEvent(env.DB, id);
  let managed = false;
  if (league) {
    const cur = await env.DB.prepare(`SELECT home_team, away_team, competition, event_date, venue FROM events WHERE id = ?`).bind(id).first();
    managed = ['home_team', 'away_team', 'competition', 'event_date', 'venue'].some(k => e[k] !== cur[k]);
    Object.assign(e, cur);
  }

  await ensureCommentarySchema(env.DB);
  await env.DB.prepare(
    `UPDATE events SET
       home_team = ?, away_team = ?, competition = ?, event_date = ?, venue = ?,
       vip_price_kobo = ?, premium_price_kobo = ?, regular_price_kobo = ?, active = ?,
       programme_url = ?, is_home = ?, commentary_enabled = ?, commentary_start_at = ?, public_sale_at = ?
     WHERE id = ?`
  ).bind(
    e.home_team, e.away_team, e.competition, e.event_date, e.venue,
    e.vip_price_kobo, e.premium_price_kobo, e.regular_price_kobo, e.active, e.programme_url, e.is_home,
    e.commentary_enabled, e.commentary_start_at, e.public_sale_at, id
  ).run();

  await syncChecklistsQuietly(env); // Match Checklist: new kick-off time moves the due times
  return Response.json({ ok: true, ...(managed ? { note: 'Saved. The teams, date, time and venue of league matches are changed in League > Fixtures, so those were kept.' } : {}) });
}

// DELETE /api/admin/events/:id -- only allowed while no tickets have been
// sold. Once there are paid orders the match must stay for ticket lookups
// and gate scans, so callers should set it inactive instead.
export async function onRequestDelete({ request, env, params }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  if (!can(admin, FIXTURE)) return Response.json({ error: 'Only staff who manage fixtures can delete a match.' }, { status: 403 });

  const id = (params.id || '').trim();
  const existing = await env.DB.prepare(`SELECT id FROM events WHERE id = ?`).bind(id).first();
  if (!existing) return Response.json({ error: 'Match not found' }, { status: 404 });

  if (await leagueFixtureForEvent(env.DB, id)) {
    return Response.json({ error: 'This is a league match: postpone, cancel or delete it in League > Fixtures.' }, { status: 409 });
  }

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
  await syncChecklistsQuietly(env); // its Match Checklist is closed (kept, not deleted)
  return Response.json({ ok: true });
}
