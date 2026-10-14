import { catalogue } from '../_lib/ticketShop.js';
import { offersFor } from '../_lib/ticketDiscounts.js';
import { readSession } from '../_lib/session.js';
import { presaleMs } from '../_lib/rewardsTiers.js';

// GET /api/tickets/catalogue -- every Lobi Stars HOME match from Matchday 1 to
// the last, with its stands, prices, seats left and whether it can be bought.
// No personal data. Away matches are never listed (tickets are sold by the home club),
// nor are matches already played (kick-off more than 3 hours ago).
export async function onRequestGet({ request, env }) {
  try {
    // Gold/Star Rewards members (signed in) see matches open early for them (presale).
    const earlyMs = await presaleMs(env.DB, await readSession(request, env.SESSION_SECRET).catch(() => null));
    const cat = await catalogue(env, { earlyMs });
    const playedBefore = Date.now() - 3 * 3600e3;
    const matches = [...cat.values()].filter(c => c.event.is_home && c.event.status !== 'cancelled' && !(c.ticket.state === 'closed' && Date.parse(c.event.event_date) < playedBefore))
      .sort((a, b) => Date.parse(a.event.event_date) - Date.parse(b.event.event_date))
      .map(c => ({
        id: c.event.id, slug: c.event.slug, matchday: c.matchday, competition: c.event.competition,
        homeTeam: c.event.home_team, awayTeam: c.event.away_team, kickoff: c.event.event_date, venue: c.event.venue, status: c.event.status,
        state: c.ticket.state, opensAt: c.ticket.opensAt || null, presale: !!c.ticket.presale, maxPerOrder: c.ticket.maxPerOrder,
        tiers: c.ticket.tiers.map(t => ({ tier: t.tier, label: t.label, priceKobo: t.priceKobo, left: t.remaining })),
      }));
    // Discount badges (Group, Early bird, Family bundle) when a rule is on and applies.
    const offers = await offersFor(env.DB, matches);
    for (const m of matches) m.offers = offers.get(m.id) || null;
    return Response.json({ matches, serverTime: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[tickets] catalogue', err);
    return Response.json({ error: 'Could not load the matches.' }, { status: 500 });
  }
}
