import { publicSquad } from '../_lib/squadPublish.js';

// GET /api/squad/public -- the verified players and staff of the current season,
// PUBLIC fields only (age, never the date of birth; no contact details, no media
// notes, no pronunciation). Read by scripts/fetch-squad.mjs when the website is built.
export async function onRequestGet({ env }) {
  try {
    return Response.json(await publicSquad(env), { headers: { 'Cache-Control': 'public, max-age=60', 'X-Robots-Tag': 'noindex' } });
  } catch (err) {
    console.error('[squad] public', err);
    return Response.json({ error: 'Could not load the squad.' }, { status: 500 });
  }
}
