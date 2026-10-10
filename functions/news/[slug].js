import { renderPage, publicMatches, nextFixtureHtml } from '../api/_lib/ssr.js';
import { readSession } from '../api/_lib/session.js';
import { membershipOf } from '../api/_lib/membership.js';
import { seasonConfig } from '../api/_lib/seasonConfig.js';
import membersContent from '../api/_generated/membersContent.js';

// /news/<slug> -- the built article, with the next Lobi Stars fixture card
// (and Buy Tickets for home games) filled in on the server. Members-only
// stories: the text was removed from the public page at build time and is
// added back here for confirmed members only.
export async function onRequestGet({ request, env, params }) {
  const slug = String(params.slug || '').replace(/[^a-z0-9-]/gi, '');
  const card = nextFixtureHtml(await publicMatches(env));
  const handlers = [
    ['#nextFixture', { element(el) { if (card) { el.setInnerContent(card, { html: true }); el.removeAttribute('hidden'); } } }],
  ];
  const gated = Object.prototype.hasOwnProperty.call(membersContent, slug);
  if (gated) {
    const memberId = await readSession(request, env.SESSION_SECRET);
    const m = memberId ? await membershipOf(env.DB, memberId, (await seasonConfig(env, request)).currentSeason) : null;
    if (m?.active) handlers.push(['[data-ms-lock]', { element(el) { el.replace(membersContent[slug], { html: true }); } }]);
  }
  const res = await renderPage(request, env, `/news/${slug}/`, handlers);
  // Members-only pages differ per visitor, so they must never be cached.
  if (!gated) return res;
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'private, no-store');
  return new Response(res.body, { status: res.status, headers });
}
