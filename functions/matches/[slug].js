import { jsonScript } from '../api/_lib/ssr.js';
import { ensureTable, loadMatch, toPublic } from '../api/_lib/matchCentre.js';
import { matchSlug } from '../api/_lib/matchSlug.js';
import { matchImagePath, MATCH_FALLBACK_IMAGE } from '../api/_lib/shareImage.js';

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

  // Embed the match (same shape as /api/matches/<slug>) so the page renders at once, and
  // replace the placeholder line with the match itself in case scripts don't run.
  let embed = '';
  let status = 'scheduled';
  try {
    const m = await loadMatch(env.DB, event.id);
    const data = { match: toPublic(m.event, m.centre), serverTime: new Date().toISOString() };
    status = data.match.status || status;
    embed = jsonScript('ssr-match', data);
  } catch { /* the page fetches it instead */ }

  // Share image: Lobi Stars v the opponent with both crests (made at build time), else the general one.
  let image = matchImagePath(event.home_team, event.away_team);
  try { if (!(await env.ASSETS.fetch(new URL(image, url))).ok) image = MATCH_FALLBACK_IMAGE; } catch { image = MATCH_FALLBACK_IMAGE; }
  const imageUrl = `${url.origin}${image}`;

  // Structured data for search engines: the match (SportsEvent) and breadcrumbs.
  const eventStatus = /postpon/i.test(status) ? 'EventPostponed' : /cancel|abandon/i.test(status) ? 'EventCancelled' : 'EventScheduled';
  const team = name => ({ '@type': 'SportsTeam', name });
  const ld = [{
    '@context': 'https://schema.org', '@type': 'SportsEvent', name: `${event.home_team} vs ${event.away_team}`,
    description, sport: 'Soccer', url: canonical, image: imageUrl,
    startDate: new Date(event.event_date).toISOString(), eventStatus: `https://schema.org/${eventStatus}`,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: { '@type': 'Place', name: event.venue || 'TBC', address: event.venue || 'Nigeria' },
    homeTeam: team(event.home_team), awayTeam: team(event.away_team), competitor: [team(event.home_team), team(event.away_team)],
    organizer: { '@type': 'SportsOrganization', name: event.competition || 'Nigerian football', url: url.origin },
  }, {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [['Home', `${url.origin}/`], ['Fixtures & Results', `${url.origin}/fixtures/`], [`${event.home_team} vs ${event.away_team}`, canonical]]
      .map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })),
  }];
  const ldHtml = ld.map(d => `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, '\\u003c')}</script>`).join('');
  const imgAlt = `${event.home_team} vs ${event.away_team} | Lobi Stars FC`;
  const line = `${event.home_team} vs ${event.away_team} · ${date} · ${event.venue}`;

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
    .on('meta[property="og:image"]', set(imageUrl))
    .on('meta[name="twitter:image"]', set(imageUrl))
    .on('meta[property="og:image:alt"]', set(imgAlt))
    .on('head', { element(el) { el.append(ldHtml + embed, { html: true }); } })
    .on('#mcStatus', { element(el) { el.setInnerContent(line); } })
    .on('[data-match-share]', { element(el) { el.removeAttribute('hidden'); } })
    .transform(new Response(shell.body, { status: 200, headers }));
  return rewritten;
}
