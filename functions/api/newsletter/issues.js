import { ensureNewsletterSchema } from '../_lib/newsletter.js';

// GET /api/newsletter/issues -- sent newsletters for the archive on /newsletter.
export async function onRequestGet({ env }) {
  await ensureNewsletterSchema(env.DB);
  const { results } = await env.DB.prepare(`SELECT slug, subject, headline, preheader, sent_at FROM newsletter_issues WHERE status = 'sent' ORDER BY sent_at DESC LIMIT 30`).all();
  return Response.json({ issues: results }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
