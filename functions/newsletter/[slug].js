import { ensureNewsletterSchema } from '../api/_lib/newsletter.js';

// /newsletter/<slug>/ -- the web version of a sent newsletter ("View it in
// your browser"), as it was sent but without anyone's personal links.
export async function onRequestGet({ env, params }) {
  await ensureNewsletterSchema(env.DB);
  const row = await env.DB.prepare(`SELECT html_snapshot FROM newsletter_issues WHERE slug = ? AND status = 'sent'`).bind(String(params.slug || '')).first();
  if (!row?.html_snapshot) return Response.redirect('https://lobistarsfc.com/newsletter/', 302);
  return new Response(row.html_snapshot, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Robots-Tag': 'noindex' } });
}
