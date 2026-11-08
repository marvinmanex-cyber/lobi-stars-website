// "/man-of-the-match/" -- the page with the latest Man of the Match card, the sponsor and this
// season's winners filled in on the server (so fans and search engines see the winner straight away).
// At or after closing time, this request also counts and saves the announcement (once). The page's
// own script checks /api/motm/current.json every 30 seconds while voting is upcoming or open.
import { motmStatus, seasonArchive, getSponsor } from './api/_lib/motmService.js';
import { sponsorView } from './api/_lib/motmRules.js';
import { cardHtml, sponsorHtml } from './api/_lib/motmCard.js';

export async function onRequestGet({ request, env }) {
  const page = await env.ASSETS.fetch(new URL('/man-of-the-match/', request.url));
  if (!page.ok || !(page.headers.get('content-type') || '').includes('text/html')) return page;
  let s;
  try {
    s = await motmStatus(env, request, '');
    s.archive = await seasonArchive(env, { sponsor: sponsorView(await getSponsor(env.DB)) });
  } catch (err) { console.error('[motm page]', err); return page; }
  const headers = new Headers(page.headers);
  headers.set('Cache-Control', 'no-store');
  return new HTMLRewriter()
    .on('#motmSponsorTop', { element(e) { e.setInnerContent(sponsorHtml(s.sponsor), { html: true }); } })
    .on('#motmCard', { element(e) { e.setAttribute('data-status', s.status); e.setInnerContent(cardHtml(s), { html: true }); } })
    .transform(new Response(page.body, { status: page.status, headers }));
}
