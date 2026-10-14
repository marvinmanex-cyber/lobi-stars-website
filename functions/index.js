import { renderPage, fill, publicMatches, nextMatchesHtml, fullTimeBannerHtml, previewSlugs } from './api/_lib/ssr.js';
import { programmeStripData, programmeStripHtml } from './api/_lib/programmeStrip.js';

// "/" -- the homepage, with "Next Matches", the 24-hour "FULL TIME" banner and
// the Match Day Programme strip (next opponent) filled in on the server. The page is the same for every visitor, so
// it is kept in Cloudflare's cache for 30 seconds (faster first byte, fewer
// database reads); live details on the page refresh themselves in the browser.
export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const key = new Request(new URL('/', request.url).toString());
  try { const hit = await cache.match(key); if (hit) return hit; } catch { /* no cache: build the page */ }
  const [matches, banner, previews] = await Promise.all([publicMatches(env), fullTimeBannerHtml(env), previewSlugs(request, env)]);
  const strip = programmeStripHtml(await programmeStripData(env, matches).catch(err => { console.error('[home] programme strip', err); return null; }));
  const res = await renderPage(request, env, '/', [
    ['[data-nm-track]', fill(nextMatchesHtml(matches, Date.now(), previews))],
    ['#ftBanner', { element(el) { if (banner) { el.setInnerContent(banner, { html: true }); el.removeAttribute('hidden'); } } }],
    ['#pgb', { element(el) { if (strip) { el.setInnerContent(strip, { html: true }); el.removeAttribute('hidden'); } } }],
  ], { 'ssr-matches': { matches }, 'ssr-previews': previews });
  if (res.status !== 200) return res;
  // Read the transformed page once so the cached copy and this answer are identical.
  const body = await res.arrayBuffer();
  const out = new Response(body, { status: 200, headers: res.headers });
  try { waitUntil(cache.put(key, out.clone())); } catch { /* serving still works */ }
  return out;
}
