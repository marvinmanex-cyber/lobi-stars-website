import { renderPage, fill, publicMatches, nextMatchesHtml, fullTimeBannerHtml } from './api/_lib/ssr.js';

// "/" -- the homepage, with "Next Matches" and the 24-hour "FULL TIME"
// banner filled in on the server.
export async function onRequestGet({ request, env }) {
  const [matches, banner] = await Promise.all([publicMatches(env), fullTimeBannerHtml(env)]);
  return renderPage(request, env, '/', [
    ['[data-nm-track]', fill(nextMatchesHtml(matches))],
    ['#ftBanner', { element(el) { if (banner) { el.setInnerContent(banner, { html: true }); el.removeAttribute('hidden'); } } }],
  ], { 'ssr-matches': { matches } });
}
