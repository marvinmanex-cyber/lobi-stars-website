import { seasonSettings, availability, upcomingHomeMatches, MAX_PER_ORDER } from '../_lib/seasonTickets.js';
import { seasonConfig } from '../_lib/seasonConfig.js';
import { engineActive } from '../_lib/ticketing/engineStore.js';
import { engineSeasonOffer, seasonTiers } from '../_lib/ticketing/engineSeason.js';

// GET /api/season-tickets -- is the season ticket on sale, for which season,
// each stand's price and how many are left, and how many home matches remain.
export async function onRequestGet({ request, env }) {
  const headers = { 'Cache-Control': 'public, max-age=30' };
  try {
    const s = await seasonSettings(env.DB, (await seasonConfig(env, request)).currentSeason);
    // Ticketing engine mode: the engine's season pass offer (prices, passes left, sale times).
    const engineMode = await engineActive(env);
    let avail;
    if (engineMode) {
      const v = seasonTiers(await engineSeasonOffer(env));
      if (!v.open || !Object.values(v.tiers).some(t => t.onSale)) return Response.json({ enabled: false }, { headers });
      if (v.season) s.season = v.season;
      avail = v.tiers;
    } else {
      if (!s.enabled) return Response.json({ enabled: false }, { headers });
      avail = await availability(env.DB, s);
    }
    const home = await upcomingHomeMatches(env.DB, s.season);
    return Response.json({
      enabled: true, season: s.season, info: s.info, maxPerOrder: MAX_PER_ORDER,
      tiers: Object.values(avail).filter(t => t.onSale).map(({ tier, label, priceKobo, remaining, limit }) => ({ tier, label, priceKobo, remaining, soldOut: !!limit && remaining === 0 })),
      homeMatchesLeft: home.length,
      nextHomeMatch: home[0] ? { home: home[0].home_team, away: home[0].away_team, date: home[0].event_date } : null,
    }, { headers });
  } catch (err) {
    console.error('[season] info', err);
    return Response.json({ enabled: false }, { headers });
  }
}
