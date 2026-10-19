// GET /api/analytics/config -- the GA4 Measurement ID for /ga.js, which only asks
// for it after the visitor accepted analytics cookies. Set GA4_MEASUREMENT_ID
// (e.g. G-XXXXXXXXXX) in Cloudflare; without it GA4 stays off. The Measurement
// ID is public by design (every GA4 website shows it); nothing secret is returned.
export async function onRequestGet({ env }) {
  const id = String(env.GA4_MEASUREMENT_ID || '').trim();
  return Response.json({ ga4: /^G-[A-Z0-9]{4,20}$/.test(id) ? id : null }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
