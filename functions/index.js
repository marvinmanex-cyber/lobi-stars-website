import { renderPage, fill, publicMatches, nextMatchesHtml } from './api/_lib/ssr.js';

// "/" -- the homepage, with "Next Matches" filled in on the server.
export async function onRequestGet({ request, env }) {
  const matches = await publicMatches(env);
  return renderPage(request, env, '/', [['[data-nm-track]', fill(nextMatchesHtml(matches))]], { 'ssr-matches': { matches } });
}
