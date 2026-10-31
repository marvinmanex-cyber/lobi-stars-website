import { pressKit } from '../_lib/mediaPressKit.js';

// GET /api/media/press-kit -- the published press kit (for /media/press-kit).
export async function onRequestGet({ env }) {
  return Response.json({ sections: await pressKit(env.DB) }, { headers: { 'Cache-Control': 'public, max-age=60' } });
}
