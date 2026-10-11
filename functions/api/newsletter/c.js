import { ensureNewsletterSchema, parseIssue, safeUrl, SITE } from '../_lib/newsletter.js';

// GET /api/newsletter/c?i=<issue>&k=<kind>&r=<ref> -- a click in a newsletter.
// Counted (for the sponsor report), then sent on to the address saved for
// that issue or sponsor. The address always comes from our database, so
// this can't be used to send people to other sites.
//   k = s (sponsor, r = sponsor id), t (story, r = position), h (main button), m (next match)
export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const i = u.searchParams.get('i') || '', k = u.searchParams.get('k') || '', r = u.searchParams.get('r') || '';
  const go = url => Response.redirect(url, 302);
  try {
    await ensureNewsletterSchema(env.DB);
    const issue = parseIssue(await env.DB.prepare(`SELECT * FROM newsletter_issues WHERE id = ?`).bind(i).first());
    if (!issue) return go(`${SITE}/`);
    let target = '';
    if (k === 's') {
      const s = await env.DB.prepare(`SELECT link FROM newsletter_sponsors WHERE id = ?`).bind(r).first();
      target = safeUrl(s?.link);
      if (target && /^https?:/i.test(target)) {
        const t = new URL(target);
        if (!t.searchParams.has('utm_source')) { t.searchParams.set('utm_source', 'lobistarsfc'); t.searchParams.set('utm_medium', 'newsletter'); t.searchParams.set('utm_campaign', issue.slug || issue.id); }
        target = t.toString();
      }
    } else if (k === 't') target = safeUrl(issue.stories?.[Number(r)]?.url);
    else if (k === 'h') target = safeUrl(issue.hero_button_url);
    else if (k === 'm') target = '/fixtures/';
    if (!target) return go(`${SITE}/`);
    if (issue.status === 'sent') await env.DB.prepare(`INSERT INTO newsletter_clicks (issue_id, kind, ref, at) VALUES (?, ?, ?, ?)`).bind(issue.id, k, r, new Date().toISOString()).run();
    return go(target.startsWith('/') ? `${SITE}${target}` : target);
  } catch {
    return go(`${SITE}/`);
  }
}
