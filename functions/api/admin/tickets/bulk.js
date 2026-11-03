import { ticketAuth, ok, fail, parseTicketSettings, saveTicketSettings, salesView } from '../../_lib/ticketAdmin.js';
import { logLeague } from '../../_lib/leagueDb.js';

// POST /api/admin/tickets/bulk { prices?, capacities?, discounts?, modes?, maxPerOrder?, isOnSale? }
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
    // A discount must leave something to pay on every match it is applied to.
    if (b.discounts) {
      for (const m of matches) for (const t of m.tiers) {
        const off = Number(b.discounts[t.tier]) || 0, price = b.prices?.[t.tier] !== undefined && b.prices[t.tier] !== '' ? Number(b.prices[t.tier]) : t.priceNaira;
        if (off > 0 && price > 0 && off >= price) return fail(`${t.label}: the discount (₦${off.toLocaleString('en-NG')}) must be less than the price (₦${price.toLocaleString('en-NG')}) for ${m.homeTeam} vs ${m.awayTeam}.`);
      }
    }
    for (const m of matches) await saveTicketSettings(env.DB, m.id, parsed, staff);
    await logLeague(env.DB, staff, 'tickets.bulk', 'tickets', 'all-home', null, { applied: matches.length, ...rest });
    return ok({ applied: matches.length });
  } catch (err) {
    console.error('[tickets admin] bulk', err);
    return fail('Could not apply.', 500);
  }
}
