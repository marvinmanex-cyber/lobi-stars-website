import { ensureNewsletterSchema } from '../../_lib/newsletter.js';

// GET /api/newsletter/asset/:id -- a sponsor logo or newsletter photo uploaded
// in the admin (used in emails, so it is public). Each upload has its own id.
export async function onRequestGet({ env, params }) {
  await ensureNewsletterSchema(env.DB);
  const a = await env.DB.prepare(`SELECT mime, data FROM newsletter_assets WHERE id = ?`).bind(String(params.id || '')).first();
  if (!a) return new Response('Not found', { status: 404 });
  return new Response(a.data instanceof ArrayBuffer ? a.data : new Uint8Array(a.data), {
    headers: { 'Content-Type': a.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
  });
}
