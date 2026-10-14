// The homepage "Upcoming Matches": the next Lobi Stars match as the featured
// card with a countdown, then the following matches as regular cards (3 in all).
// Pure: used by the server (functions/index.js) and the browser refresh
// (src/components/news/NextMatches.astro), so both always match. The card
// itself is the shared one (fixtureCard.js) used on /fixtures and /results.
import { TEAM_LOGOS } from '../teamLogos.js';
import { matchSlug } from '../matchSlug.js';
import { upcomingMatches, naira } from './rules.js';
import { fixtureCardHtml, shareAction, lagosParts, splitVenue, esc } from '../fixtureCard.js';

const isLobi = n => /lobi stars/i.test(n || '');

function ticketHtml(m, home) {
  if (!home) return '<span class="lg-chip lg-tix">Away fixture</span>';
  const t = m.ticket || { state: m.on_sale ? 'on_sale' : 'not_on_sale' };
  if (t.state === 'on_sale') return `<a class="lg-btn primary" href="/tickets/?event=${encodeURIComponent(m.id)}">Buy ticket${t.fromKobo ? ` <small>from ${esc(naira(t.fromKobo))}</small>` : ''}</a>`;
  if (t.state === 'sold_out') return '<span class="lg-chip bad lg-tix">Sold out</span>';
  if (t.state === 'closed') return '';
  const opens = t.opensAt ? ` (from ${esc(new Date(t.opensAt).toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short' }))})` : '';
  return `<span class="lg-chip lg-tix">Tickets not on sale yet${opens}</span>`;
}

function jsonLd(m) {
  const status = m.status === 'postponed' ? 'EventPostponed' : 'EventScheduled';
  const [locality, region] = splitVenue(m.venue).place.split(',').map(x => x.trim());
  return `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'SportsEvent', name: `${m.home_team} vs ${m.away_team}`, sport: 'Soccer',
    startDate: lagosParts(m.event_date)?.iso, eventStatus: `https://schema.org/${status}`,
    location: { '@type': 'Place', name: m.venue, address: { '@type': 'PostalAddress', ...(locality ? { addressLocality: locality } : {}), ...(region ? { addressRegion: region } : {}), addressCountry: 'NG' } },
    homeTeam: { '@type': 'SportsTeam', name: m.home_team }, awayTeam: { '@type': 'SportsTeam', name: m.away_team },
    organizer: { '@type': 'SportsOrganization', name: 'Nigeria National League' },
    url: `https://lobistarsfc.com/matches/${m.slug || matchSlug(m)}/`,
  }).replace(/</g, '\\u003c')}</script>`;
}

function card(m, featured, previews = {}) {
  const home = typeof m.is_home === 'boolean' ? m.is_home : isLobi(m.home_team);
  const slug = m.slug || matchSlug(m);
  const postponed = m.status === 'postponed';
  const preview = previews[lagosParts(m.event_date)?.ymd];
  const acts = [ticketHtml(m, home), `<a class="lg-btn" href="/matches/${esc(slug)}/">Match Centre</a>`];
  if (preview) acts.push(`<a class="lg-btn" href="/news/${esc(preview)}/">Match preview</a>`);
  if (!postponed) acts.push(`<a class="lg-btn" href="/api/calendar?match=${encodeURIComponent(slug)}">Add to calendar</a>`);
  acts.push(shareAction(`/matches/${slug}/`, `${m.home_team} vs ${m.away_team}`));
  if (featured) acts.push(`<a class="lg-btn" href="/commentary/" data-track="commentary_click" data-track-label="${esc(slug)}" aria-label="Listen live to ${esc(m.home_team)} vs ${esc(m.away_team)} on Lobi Stars FC Live">Listen live</a>`);
  const side = n => ({ name: n, crest: TEAM_LOGOS[n] || null, isLobi: isLobi(n) });
  return fixtureCardHtml({
    tag: 'li', home: side(m.home_team), away: side(m.away_team), kickoff: m.event_date, venue: m.venue, status: m.status,
    homeGoals: m.home_score, awayGoals: m.away_score, matchday: m.matchday, competition: m.competition, featured,
    actions: acts.filter(Boolean), jsonLd: jsonLd(m),
  });
}

/** The cards (HTML list items) for the Lobi Stars matches in `matches`. */
export function upcomingHtml(matches, { now = Date.now(), previews = {}, limit = 3 } = {}) {
  const list = upcomingMatches(matches.filter(m => isLobi(m.home_team) || isLobi(m.away_team)), now).slice(0, limit);
  if (!list.length) return '<li class="nm-empty">Fixtures for the next round will be announced soon. <a href="/fixtures/">See all fixtures</a></li>';
  return list.map((m, i) => card(m, i === 0, previews)).join('');
}
