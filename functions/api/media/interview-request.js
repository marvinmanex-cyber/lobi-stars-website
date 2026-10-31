import { checkRequest, createRequest } from '../_lib/mediaInterviews.js';
import { ensureFanSchema, rateLimit } from '../_lib/fans.js';

// POST /api/media/interview-request -- the public interview request form
// (spam trap "website", 5 requests an hour per connection).
const J = (d, s = 200) => Response.json(d, { status: s, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
export async function onRequestPost({ request, env }) {
  await ensureFanSchema(env.DB);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return J({ error: 'This request came from another website and was refused.' }, 403);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await rateLimit(env.DB, `interview:${ip}`, 5, 3600))) return J({ error: 'Too many requests from this connection. Please try again later.' }, 429);
  const b = await request.json().catch(() => ({}));
  if (String(b.website || '').trim()) return J({ ok: true });
  const c = checkRequest(b);
  if (c.error) return J({ error: c.error }, 400);
  await createRequest(env, request, c.value);
  return J({ ok: true });
}
