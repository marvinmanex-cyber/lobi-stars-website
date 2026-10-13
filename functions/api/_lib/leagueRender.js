// Renders /fixtures, /results and /table on the server: the built page is the
// shell, and its [data-league-root] is filled with the league HTML. If the
// league can't be loaded the page still opens with a clear message.
import { renderPage, publicMatches, previewSlugs } from './ssr.js';
import { loadLeague } from './leagueDb.js';
import { fixturesPage, resultsPage, tablePage, extraMatches, esc } from './leaguePages.js';

const FAILED = '<p class="lg-empty">The fixtures and table could not be loaded just now. Please refresh the page in a minute.</p>';

export async function renderLeaguePage(request, env, which) {
  const url = new URL(request.url);
  let html = FAILED;
  try {
    const league = await loadLeague(env);
    if (league) {
      if (which === 'table') html = tablePage(league, url);
      else {
        const [events, previews] = await Promise.all([publicMatches(env).catch(() => []), which === 'fixtures' ? previewSlugs(request, env) : {}]);
        const extras = extraMatches(events, league);
        // Tickets show only for matches on sale (prices set in Match Tickets & Settings).
        const onSale = new Map(events.map(e => [e.id, !!e.on_sale]));
        for (const f of league.fixtures) if (f.event_id) f.on_sale = onSale.get(f.event_id) || false;
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
    return new Response(res.body, { status: res.status, headers });
  }
  return res;
}
export { esc };
