// GET /api/events -- lists active purchasable matches with seat tier pricing.
export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT id, home_team, away_team, competition, event_date, venue,
            vip_price_kobo, premium_price_kobo, regular_price_kobo
     FROM events
     WHERE active = 1 AND event_date >= datetime('now')
     ORDER BY event_date ASC`
  ).all();

  return Response.json({ events: results });
}
