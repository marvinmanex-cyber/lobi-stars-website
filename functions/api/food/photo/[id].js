import { ensureMenuSchema } from '../../_lib/foodMenuDb.js';

// GET /api/food/photo/:id -- a menu item photo. Each upload gets a new id,
// so photos can be cached for a long time.
export async function onRequestGet({ env, params }) {
  await ensureMenuSchema(env.DB);
  const p = await env.DB.prepare(`SELECT mime, data FROM food_photos WHERE id = ?`).bind(String(params.id || '')).first();
  if (!p) return new Response('Not found', { status: 404 });
  return new Response(p.data instanceof ArrayBuffer ? p.data : new Uint8Array(p.data), {
    headers: { 'Content-Type': p.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
  });
}
