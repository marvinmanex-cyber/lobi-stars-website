import { publicSquad } from '../_lib/squadPublish.js';

// GET /api/squad/public -- the verified players and staff of the current season,
// PUBLIC fields only (the full date of birth and middle name only from age 18;
// no contact details, no media notes; hidden profiles left out). Read by
// scripts/fetch-squad.mjs when the website is built.
export async function onRequestGet({ env }) {
  try {
    return Response.json(await publicSquad(env), { headers: { 'Cache-Control': 'public, max-age=60', 'X-Robots-Tag': 'noindex' } });
  } catch (err) {
    console.error('[squad] public', err);
    return Response.json({ error: 'Could not load the squad.' }, { status: 500 });
  }
}
