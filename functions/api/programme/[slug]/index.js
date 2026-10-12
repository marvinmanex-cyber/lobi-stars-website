import { liveBySlug, toPublic, ensureProgrammeSchema } from '../../_lib/programme.js';
import { getFan } from '../../_lib/fanCode.js';
import { programmeState, validSlug } from '../../_lib/share.js';

// GET /api/programme/:slug
//   live:     { state: 'live', ...details, links (id and label only), signedIn, … }
//   upcoming: { state: 'upcoming', slug, title, kickoffAt, publishAt, serverTime } (scheduled, not out yet; no files)
//   draft / hidden / unknown: 404
export async function onRequestGet({ request, env, params }) {
  try {
    const p = await liveBySlug(env.DB, params.slug);
    if (!p) {
      const slug = validSlug(String(params.slug || '').toLowerCase());
      if (slug) {
        await ensureProgrammeSchema(env.DB);
        const s = await env.DB.prepare(`SELECT * FROM programmes WHERE slug = ?`).bind(slug).first();
        if (programmeState(s) === 'upcoming') {
          return Response.json({ state: 'upcoming', slug: s.slug, title: s.title, kickoffAt: s.kickoff_at, publishAt: s.publish_at, serverTime: new Date().toISOString() },
            { headers: { 'Cache-Control': 'no-store' } });
        }
      }
      return Response.json({ error: 'Programme not found' }, { status: 404 });
    }
    const fan = await getFan(request, env);
    const { results } = await env.DB.prepare(`SELECT id, label FROM programme_links WHERE programme_id = ? ORDER BY sort_order, id`).bind(p.id).all();
    return Response.json({
      state: 'live', ...toPublic(p), links: results, signedIn: !!fan, email: fan?.email || null,
      needsProfile: !!fan && !String(fan.first_name || '').trim(),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[programme] detail', err);
    return Response.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
