import { requireAdminUser } from '../../_lib/adminEvents.js';
import { ensureNewsletterSchema, renderNewsletter, loadSponsors, nextMatch, safeUrl, newsletterSettings } from '../../_lib/newsletter.js';

// POST /api/admin/newsletter/preview { issue } -- the email exactly as fans
// will see it, from what is in the editor (nothing is saved or sent).
export async function onRequestPost({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  await ensureNewsletterSchema(env.DB);
  const b = await request.json().catch(() => ({}));
  const i = b.issue || {};
  const issue = {
    id: '', subject: String(i.subject || 'Newsletter'), preheader: String(i.preheader || ''), headline: String(i.headline || ''), intro: String(i.intro || ''),
    hero_image: safeUrl(i.hero_image), hero_button_text: String(i.hero_button_text || ''), hero_button_url: safeUrl(i.hero_button_url),
    include_match: !!i.include_match, stories: Array.isArray(i.stories) ? i.stories : [], sponsor_ids: Array.isArray(i.sponsor_ids) ? i.sponsor_ids : [],
    top_sponsor_id: i.top_sponsor_id || null, status: 'draft',
  };
  const html = renderNewsletter({
    issue, sponsors: await loadSponsors(env.DB), match: issue.include_match ? await nextMatch(env.DB) : null,
    recipient: { firstName: 'Ngozi', unsubscribeUrl: 'https://lobistarsfc.com/newsletter/', optionsUrl: 'https://lobistarsfc.com/newsletter/' }, preview: true,
    base: new URL(request.url).origin, settings: await newsletterSettings(env.DB),
  });
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
