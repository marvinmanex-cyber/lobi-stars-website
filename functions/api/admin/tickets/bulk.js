import { ticketAuth, ok, fail, parseTicketSettings, saveTicketSettings, salesView } from '../../_lib/ticketAdmin.js';
import { logLeague } from '../../_lib/leagueDb.js';

// POST /api/admin/tickets/bulk { prices?, capacities?, maxPerOrder?, isOnSale? }
// "Apply to all home matches": every upcoming home match gets the same values.
// (Sale open/close times differ per match, so they are set one by one.)
export async function onRequestPost({ request, env }) {
  const { staff, denied } = await ticketAuth(request, env);
  if (denied) return denied;
  try {
    const b = await request.json().catch(() => ({}));
    const { saleOpensAt, saleClosesAt, ...rest } = b;
    const parsed = parseTicketSettings(rest, { is_home: 1 });
    if (parsed.error) return fail(parsed.error);
    if (!Object.keys(parsed.prices).length && !Object.keys(parsed.settings).length) return fail('Choose what to apply.');
    const matches = (await salesView(env)).filter(m => Date.parse(m.kickoff) > Date.now() && m.status === 'scheduled');
    for (const m of matches) await saveTicketSettings(env.DB, m.id, parsed, staff);
    await logLeague(env.DB, staff, 'tickets.bulk', 'tickets', 'all-home', null, { applied: matches.length, ...rest });
    return ok({ applied: matches.length });
  } catch (err) {
    console.error('[tickets admin] bulk', err);
    return fail('Could not apply.', 500);
  }
}
