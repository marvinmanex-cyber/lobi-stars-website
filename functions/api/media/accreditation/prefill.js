import { sendPrefillCode, prefillWithCode } from '../../_lib/mediaAccreditation.js';
import { ensureFanSchema, rateLimit } from '../../_lib/fans.js';

// POST /api/media/accreditation/prefill
//   { email }        -- emails a 6-digit code if the address is a known journalist (the answer is the same either way)
//   { email, code }  -- the saved details (name, organisation, staff/freelance, role, photo on file; never the phone)
const J = (d, s = 200) => Response.json(d, { status: s, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
export async function onRequestPost({ request, env }) {
  await ensureFanSchema(env.DB);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return J({ error: 'This request came from another website and was refused.' }, 403);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const b = await request.json().catch(() => ({}));
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/.test(email)) return J({ error: 'Enter a valid email address.' }, 400);
  if (b.code) {
    if (!(await rateLimit(env.DB, `accredcode:${ip}`, 20, 3600))) return J({ error: 'Too many tries. Please wait an hour.' }, 429);
    const r = await prefillWithCode(env.DB, email, b.code);
    return r.error ? J({ error: r.error }, 400) : J(r);
  }
  if (!(await rateLimit(env.DB, `accredpre:${ip}`, 5, 3600)) || !(await rateLimit(env.DB, `accredpre:${email}`, 3, 3600))) return J({ error: 'Too many codes asked for. Please wait an hour.' }, 429);
  await sendPrefillCode(env, email);
  return J({ ok: true, message: 'If you have applied before with this email address, we have emailed you a code.' });
}
