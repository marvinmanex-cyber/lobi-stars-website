import { ensureTable } from '../api/_lib/matchCentre.js';
import { matchSlug } from '../api/_lib/matchSlug.js';

// /matches/<slug> -- serves the static Match Centre page (built at
// /match-centre/) for any match, with the match's own title, description and
// canonical URL so shared links preview properly. The page then loads the
// match data from /api/matches/<slug>.
export async function onRequestGet({ request, env, params }) {
  const url = new URL(request.url);
  const slug = String(params.slug || '').toLowerCase();
  const shell = await env.ASSETS.fetch(new URL('/match-centre/', url));

  let event = null;
  try {
    await ensureTable(env.DB);
    const { results } = await env.DB.prepare(`SELECT * FROM events WHERE active = 1`).all();
    event = results.find(e => e.id.toLowerCase() === slug || matchSlug(e) === slug) || null;
  } catch { /* fall back to the generic page */ }

  const headers = new Headers(shell.headers);
  headers.set('Cache-Control', 'public, max-age=60');
  headers.delete('X-Robots-Tag');
  if (!event) {
    return new Response(shell.body, { status: 404, headers });
  }

  const title = `${event.home_team} vs ${event.away_team} | Match Centre | Lobi Stars FC`;
  const date = new Date(event.event_date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' });
  const description = `${event.competition}: ${event.home_team} vs ${event.away_team}, ${date} at ${event.venue}. Line-ups, live updates, report and stats.`;
  const canonical = `${url.origin}/matches/${matchSlug(event)}/`;
  const set = v => ({ element(el) { el.setAttribute('content', v); } });

  const rewritten = new HTMLRewriter()
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
  return rewritten;
}
