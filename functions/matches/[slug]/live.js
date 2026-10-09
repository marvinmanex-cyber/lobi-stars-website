import { ensureTable, isHomeGame } from '../../api/_lib/matchCentre.js';
import { matchSlug } from '../../api/_lib/matchSlug.js';

// /matches/<slug>/live -- Matchday Live (watch, listen, vote, predict). HOME
// games only: away games are sent to their normal Match Centre page. Serves
// the static page built at /matchday-live/ with the match's own title,
// description and canonical URL; the page loads match data from
// /api/matches/<slug>.
export async function onRequestGet({ request, env, params }) {
  const url = new URL(request.url);
  const slug = String(params.slug || '').toLowerCase();

  let event = null;
  try {
    await ensureTable(env.DB);
    const { results } = await env.DB.prepare(`SELECT * FROM events WHERE active = 1`).all();
    event = results.find(e => e.id.toLowerCase() === slug || matchSlug(e) === slug) || null;
  } catch { /* fall back to the generic page */ }

  if (event && !isHomeGame(event)) {
    return Response.redirect(new URL(`/matches/${matchSlug(event)}/`, url).toString(), 302);
  }

  const shell = await env.ASSETS.fetch(new URL('/matchday-live/', url));
  const headers = new Headers(shell.headers);
  headers.set('Cache-Control', 'public, max-age=60');
  if (!event) return new Response(shell.body, { status: 404, headers });

  const title = `${event.home_team} vs ${event.away_team} | Matchday Live | Lobi Stars FC`;
  const date = new Date(event.event_date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' });
  const description = `Matchday Live for ${event.home_team} vs ${event.away_team}, ${date}: watch live, listen to match commentary, vote for Man of the Match and play Predict & Win.`;
  const canonical = `${url.origin}/matches/${matchSlug(event)}/live/`;
  const set = v => ({ element(el) { el.setAttribute('content', v); } });

  return new HTMLRewriter()
    .on('title', { element(el) { el.setInnerContent(title); } })
    .on('meta[name="description"]', set(description))
    .on('meta[property="og:title"]', set(title))
    .on('meta[name="twitter:title"]', set(title))
    .on('meta[property="og:description"]', set(description))
    .on('meta[name="twitter:description"]', set(description))
    .on('meta[property="og:url"]', set(canonical))
    .on('meta[name="robots"]', { element(el) { el.remove(); } })
    .on('link[rel="canonical"]', { element(el) { el.setAttribute('href', canonical); } })
    .transform(new Response(shell.body, { status: 200, headers }));
}
