import { liveBySlug, streamObject } from '../../_lib/programme.js';

// GET /api/programme/:slug/cover.jpg -- public (shown before sign-in).
export async function onRequestGet({ env, params }) {
  const p = await liveBySlug(env.DB, params.slug).catch(() => null);
  if (!p) return new Response('Not found', { status: 404 });
  return streamObject(env, p.cover_key, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600' });
}
