import { ensureTable, toPublic } from '../_lib/matchCentre.js';
import { matchSlug } from '../_lib/matchSlug.js';

// GET /api/matches/:slug -- one match with its full Match Centre data.
// Accepts the readable slug or the raw event id.
export async function onRequestGet({ env, params }) {
  const key = String(params.slug || '').toLowerCase();
  await ensureTable(env.DB);
  const { results } = await env.DB.prepare(`SELECT * FROM events WHERE active = 1`).all();
  const event = results.find(e => e.id.toLowerCase() === key || matchSlug(e) === key);
  if (!event) return Response.json({ error: 'Match not found' }, { status: 404 });

  const centre = await env.DB.prepare(`SELECT * FROM match_centre WHERE event_id = ?`).bind(event.id).first();
  return Response.json(
    { match: toPublic(event, centre) },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
