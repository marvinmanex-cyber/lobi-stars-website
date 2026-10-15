// Renders /fixtures, /results and /table on the server: the built page is the
// shell, and its [data-league-root] is filled with the league HTML. If the
// league can't be loaded the page still opens with a clear message.
// The pages are the same for every visitor, so (like the homepage) each one is
// kept in Cloudflare's cache for 30 seconds: faster first byte and far fewer
// database reads. Staff changes show within 30 seconds (browsers were already
// allowed to keep these pages for 30 seconds).
import { renderPage, publicMatches, previewSlugs } from './ssr.js';
import { loadLeague } from './leagueDb.js';
import { fixturesPage, resultsPage, tablePage, extraMatches, esc } from './leaguePages.js';

const FAILED = '<p class="lg-empty">The fixtures and table could not be loaded just now. Please refresh the page in a minute.</p>';

export async function renderLeaguePage(request, env, which, waitUntil = null) {
  const url = new URL(request.url);
  const cache = caches.default;
  const key = new Request(new URL(`/${which}/${url.search}`, request.url).toString());
  try { const hit = await cache.match(key); if (hit) return hit; } catch { /* no cache: build the page */ }
  let html = FAILED;
  try {
    const league = await loadLeague(env);
    if (league) {
      if (which === 'table') html = tablePage(league, url);
      else {
        const [events, previews] = await Promise.all([publicMatches(env).catch(() => []), which === 'fixtures' ? previewSlugs(request, env) : {}]);
        const extras = extraMatches(events, league);
        // Tickets show only for matches on sale (prices set in Match Tickets & Settings).
        const byEvent = new Map(events.map(e => [e.id, e]));
        for (const f of league.fixtures) if (f.event_id) { const e = byEvent.get(f.event_id); f.on_sale = !!e?.on_sale; f.ticket = e?.ticket || null; }
        html = which === 'fixtures' ? fixturesPage(league, extras, url, previews) : resultsPage(league, extras, url);
      }
    }
  } catch (err) {
    console.error(`[league] ${which} page`, err);
  }
  const res = await renderPage(request, env, `/${which}/`, [
    ['[data-league-root]', { element(el) { el.setInnerContent(html, { html: true }); el.removeAttribute('aria-busy'); } }],
  ]);
  // Filtered views are the same page: search engines index the main address.
  if (url.search && res.ok) {
    const headers = new Headers(res.headers);
    headers.set('X-Robots-Tag', 'noindex, follow');
    return keep(new Response(res.body, { status: res.status, headers }));
  }
  return keep(res);

  // Only a page that loaded properly is kept (not the "could not be loaded" message).
  async function keep(r) {
    if (r.status !== 200 || html === FAILED || !waitUntil) return r;
    const out = new Response(await r.arrayBuffer(), { status: 200, headers: r.headers });
    try { waitUntil(cache.put(key, out.clone())); } catch { /* serving still works */ }
    return out;
  }
}
export { esc };
