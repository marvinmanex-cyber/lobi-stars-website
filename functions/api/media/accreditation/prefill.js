import { prefill } from '../../_lib/mediaAccreditation.js';
import { ensureFanSchema, rateLimit } from '../../_lib/fans.js';

// GET /api/media/accreditation/prefill?email= -- a returning journalist (recognised by
// email): name, organisation, staff/freelance and role to prefill the form, and
// whether a passport photo is on file. Never the phone number or the photo itself.
export async function onRequestGet({ request, env }) {
  await ensureFanSchema(env.DB);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await rateLimit(env.DB, `accredpre:${ip}`, 20, 3600))) return Response.json({ known: false }, { headers: { 'Cache-Control': 'no-store' } });
  const email = new URL(request.url).searchParams.get('email') || '';
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/.test(email)) return Response.json({ known: false });
  return Response.json(await prefill(env.DB, email), { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
