import { renderPage, fill, publicMatches, watchHtml } from './api/_lib/ssr.js';

// "/watch" -- streaming schedule, last result and replays rendered on the server.
export async function onRequestGet({ request, env }) {
  const matches = await publicMatches(env);
  const h = watchHtml(matches);
  return renderPage(request, env, '/watch/', [
    ['#wlUp', fill(h.schedule)],
    ['#wlLast', { element(el) { if (h.last) { el.setInnerContent(h.last, { html: true }); el.removeAttribute('hidden'); } } }],
    ['#wlRp', fill(h.replays)],
    ['#wlRpSec', { element(el) { if (h.replays) el.removeAttribute('hidden'); } }],
  ], { 'ssr-matches': { matches } });
}
