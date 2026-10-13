import { ticketAuth, ok, fail, parseTicketSettings, saveTicketSettings } from '../../../_lib/ticketAdmin.js';
import { logLeague } from '../../../_lib/leagueDb.js';
import { isHomeGame } from '../../../_lib/matchCentre.js';

// PUT /api/admin/tickets/match/:eventId { prices, capacities, saleOpensAt, saleClosesAt, maxPerOrder, isOnSale }
// Times are Nigerian time ("YYYY-MM-DDTHH:MM"). Away matches can never be put on sale.
export async function onRequestPut({ request, env, params }) {
  const { staff, denied } = await ticketAuth(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    const event = await db.prepare(`SELECT * FROM events WHERE id = ?`).bind(String(params.id || '')).first();
    if (!event) return fail('Match not found.', 404);
    const b = await request.json().catch(() => ({}));
    const home = isHomeGame(event);
    const parsed = parseTicketSettings(b, { ...event, is_home: home ? 1 : 0 });
    if (parsed.error) return fail(parsed.error);
    const before = { prices: [event.vip_price_kobo, event.premium_price_kobo, event.regular_price_kobo], settings: await db.prepare(`SELECT * FROM league_ticket_settings WHERE event_id = ?`).bind(event.id).first() };
    await saveTicketSettings(db, event.id, parsed, staff);
    const after = { prices: Object.values(parsed.prices), settings: await db.prepare(`SELECT * FROM league_ticket_settings WHERE event_id = ?`).bind(event.id).first() };
    await logLeague(db, staff, 'tickets.settings', 'tickets', event.id, before, after);
    return ok();
  } catch (err) {
    console.error('[tickets admin] save', err);
    return fail('Could not save.', 500);
  }
}
