import { liveBySlug, logEvent, PAGE_COUNT } from '../../_lib/programme.js';
import { getFan, hashIp } from '../../_lib/fanCode.js';
import { clientIp, rateLimit } from '../../_lib/fans.js';

const ALLOWED = ['landing', 'open', 'page_view', 'share'];

// POST /api/programme/:slug/event { type, page?, src? } -- reading statistics.
// Requests from another site are ignored (204, nothing stored).
export async function onRequestPost({ request, env, params }) {
  try {
    if (request.headers.get('Origin') !== new URL(request.url).origin) return new Response(null, { status: 204 });
    const b = await request.json().catch(() => ({}));
    if (!ALLOWED.includes(b.type)) return Response.json({ error: 'Unknown event' }, { status: 400 });
    const p = await liveBySlug(env.DB, params.slug);
    if (!p) return Response.json({ error: 'Programme not found' }, { status: 404 });
    const page = b.type === 'page_view' ? Number(b.page) : null;
    if (b.type === 'page_view' && !(Number.isInteger(page) && page >= 1 && page <= PAGE_COUNT)) return Response.json({ error: 'Bad page' }, { status: 400 });
    if (!(await rateLimit(env.DB, `progev:${await hashIp(clientIp(request), env.SESSION_SECRET || '')}`, 300, 3600))) return new Response(null, { status: 204 });
    const fan = await getFan(request, env);
    await logEvent(env.DB, { programmeId: p.id, fanId: fan?.id || null, type: b.type, page, src: b.src });
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error('[programme] event', err);
    return new Response(null, { status: 204 });
  }
}
