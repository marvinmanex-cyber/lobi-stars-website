import { liveBySlug, toPublic } from '../../_lib/programme.js';
import { getFan } from '../../_lib/fanCode.js';

// GET /api/programme/:slug -- details and quick links (id and label only) of a live programme.
export async function onRequestGet({ request, env, params }) {
  try {
    const p = await liveBySlug(env.DB, params.slug);
    if (!p) return Response.json({ error: 'Programme not found' }, { status: 404 });
    const fan = await getFan(request, env);
    const { results } = await env.DB.prepare(`SELECT id, label FROM programme_links WHERE programme_id = ? ORDER BY sort_order, id`).bind(p.id).all();
    return Response.json({
      ...toPublic(p), links: results, signedIn: !!fan, email: fan?.email || null,
      needsProfile: !!fan && !String(fan.first_name || '').trim(),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[programme] detail', err);
    return Response.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
