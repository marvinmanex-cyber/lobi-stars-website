import { partnerFeed } from '../_lib/squadPublish.js';

// GET /api/partner/squad[?since=ISO] -- for the club's official media partner.
// Protected by LOBI_PARTNER_API_KEY (header "Authorization: Bearer <key>" or
// "X-API-Key: <key>"). Verified profiles of the current season with Public and
// Media fields only (never private details), in the SAME structure as data.json
// in the Data Package (schemaVersion 1.0), with photo and recording links that
// expire after 24 hours and "updatedAt" per profile. ?since= returns only
// profiles changed after that time.
export async function onRequestGet({ request, env }) {
  if (!env.LOBI_PARTNER_API_KEY) return Response.json({ error: 'The partner API is not set up (LOBI_PARTNER_API_KEY).' }, { status: 503 });
  const auth = request.headers.get('Authorization') || '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7) : request.headers.get('X-API-Key') || '';
  if (!key || key !== env.LOBI_PARTNER_API_KEY) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const u = new URL(request.url);
  const since = u.searchParams.get('since');
  if (since && Number.isNaN(Date.parse(since))) return Response.json({ error: 'since must be a date and time, e.g. 2026-10-22T11:00:00Z' }, { status: 400 });
  const doc = await partnerFeed(env, String(env.SITE_URL || u.origin).replace(/\/+$/, ''), { since: since ? new Date(since).toISOString() : null });
  return Response.json(doc, { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
