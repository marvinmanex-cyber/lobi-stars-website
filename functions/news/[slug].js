import { renderPage, publicMatches, nextFixtureHtml } from '../api/_lib/ssr.js';

// /news/<slug> -- the built article, with the next Lobi Stars fixture card
// (and Buy Tickets for home games) filled in on the server.
export async function onRequestGet({ request, env, params }) {
  const slug = String(params.slug || '').replace(/[^a-z0-9-]/gi, '');
  const card = nextFixtureHtml(await publicMatches(env));
  return renderPage(request, env, `/news/${slug}/`, [
    ['#nextFixture', { element(el) { if (card) { el.setInnerContent(card, { html: true }); el.removeAttribute('hidden'); } } }],
  ]);
}
