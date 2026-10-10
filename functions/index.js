import { renderPage, fill, publicMatches, nextMatchesHtml, fullTimeBannerHtml, previewSlugs } from './api/_lib/ssr.js';

// "/" -- the homepage, with "Next Matches" and the 24-hour "FULL TIME"
// banner filled in on the server.
export async function onRequestGet({ request, env }) {
  const [matches, banner, previews] = await Promise.all([publicMatches(env), fullTimeBannerHtml(env), previewSlugs(request, env)]);
  return renderPage(request, env, '/', [
    ['[data-nm-track]', fill(nextMatchesHtml(matches, Date.now(), previews))],
    ['#ftBanner', { element(el) { if (banner) { el.setInnerContent(banner, { html: true }); el.removeAttribute('hidden'); } } }],
  ], { 'ssr-matches': { matches }, 'ssr-previews': previews });
}
