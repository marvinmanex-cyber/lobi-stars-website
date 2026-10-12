import { ensureProgrammeSchema, LIVE_SQL, toPublic, bucket } from '../_lib/programme.js';

// GET /api/programme/archive?page=1 -- live programmes, newest first, 12 a page.
export async function onRequestGet({ request, env }) {
  try {
    if (!bucket(env)) return Response.json({ items: [], page: 1, more: false });
    await ensureProgrammeSchema(env.DB);
    const page = Math.max(1, Math.min(500, Number(new URL(request.url).searchParams.get('page')) || 1));
    const { results } = await env.DB.prepare(`SELECT * FROM programmes WHERE ${LIVE_SQL} ORDER BY kickoff_at DESC, id DESC LIMIT 13 OFFSET ?`)
      .bind(new Date().toISOString(), (page - 1) * 12).all();
    return Response.json({ items: results.slice(0, 12).map(p => toPublic(p)), page, more: results.length > 12 }, { headers: { 'Cache-Control': 'public, max-age=60' } });
  } catch (err) {
    console.error('[programme] archive', err);
    return Response.json({ items: [], page: 1, more: false });
  }
}
