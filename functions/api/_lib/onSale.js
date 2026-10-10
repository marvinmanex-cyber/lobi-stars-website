import { ensureTable } from './matchCentre.js';

// Matches currently on sale (active, kick-off still in the future), used by
// /api/events, the tickets page and the matchday programme page.
export async function onSaleEvents(db) {
  await ensureTable(db); // adds newer columns such as public_sale_at
  const { results } = await db.prepare(
    `SELECT id, home_team, away_team, competition, event_date, venue,
            vip_price_kobo, premium_price_kobo, regular_price_kobo, programme_url, public_sale_at
     FROM events
     WHERE active = 1 AND event_date >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     ORDER BY event_date ASC`
  ).all();
  return results;
}
