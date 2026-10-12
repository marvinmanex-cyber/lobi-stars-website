import { validSrc, logCampaignEvent } from '../_lib/qr.js';
import { hashIp } from '../_lib/fanCode.js';
import { clientIp, rateLimit } from '../_lib/fans.js';

// POST /api/qr/event { src, type: 'landing' } -- the scan page has opened for a
// campaign. Other steps are counted by the server itself. Requests from other
// sites are ignored; answers are always 204 so tracking can never break the page.
export async function onRequestPost({ request, env, waitUntil }) {
  try {
    if (request.headers.get('Origin') !== new URL(request.url).origin) return new Response(null, { status: 204 });
    const b = await request.json().catch(() => ({}));
    const src = validSrc(b.src);
    if (!src || b.type !== 'landing') return new Response(null, { status: 204 });
    if (!(await rateLimit(env.DB, `qrev:${await hashIp(clientIp(request), env.SESSION_SECRET || '')}`, 120, 3600))) return new Response(null, { status: 204 });
    logCampaignEvent(env, src, 'landing', { request }, waitUntil);
  } catch (err) {
    console.error('[qr] landing', err);
  }
  return new Response(null, { status: 204 });
}
