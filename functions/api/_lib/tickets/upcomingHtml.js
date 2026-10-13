// The homepage "Upcoming Matches": the next Lobi Stars match as a large card
// with a countdown, then the following matches as smaller cards (3 in all).
// Pure: used by the server (functions/index.js) and the browser refresh
// (src/components/news/NextMatches.astro), so both always match.
import { TEAM_LOGOS } from '../teamLogos.js';
import { matchSlug } from '../matchSlug.js';
import { upcomingMatches, naira } from './rules.js';

const TZ = 'Africa/Lagos';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isLobi = n => /lobi stars/i.test(n || '');
const LIVE = ['live', 'half-time'];

const crest = (name, size) => (TEAM_LOGOS[name]
  ? `<img class="nm-crest" src="${esc(TEAM_LOGOS[name])}" alt="" loading="lazy" width="${size}" height="${size}">`
  : `<span class="nm-crest nm-crest-fallback" aria-hidden="true" style="width:${size}px;height:${size}px">${esc(String(name || '?').charAt(0))}</span>`);

function ticketHtml(m, home) {
  if (!home) return '<span class="nm-ticket nm-ticket--away">Away fixture</span>';
  const t = m.ticket || { state: m.on_sale ? 'on_sale' : 'not_on_sale' };
  if (t.state === 'on_sale') return `<a class="nm-btn nm-btn--buy" href="/tickets/?event=${encodeURIComponent(m.id)}">Buy ticket${t.fromKobo ? ` <small>from ${esc(naira(t.fromKobo))}</small>` : ''}</a>`;
  if (t.state === 'sold_out') return '<span class="nm-ticket nm-ticket--out">Sold out</span>';
  if (t.state === 'closed') return '';
  const opens = t.opensAt ? ` (from ${esc(new Date(t.opensAt).toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' }))})` : '';
  return `<span class="nm-ticket">Tickets not on sale yet${opens}</span>`;
}

function jsonLd(m) {
  const l = new Date(Date.parse(m.event_date) + 3600e3).toISOString();
  const status = m.status === 'postponed' ? 'EventPostponed' : 'EventScheduled';
  return `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'SportsEvent', name: `${m.home_team} vs ${m.away_team}`, sport: 'Soccer',
    startDate: `${l.slice(0, 19)}+01:00`, eventStatus: `https://schema.org/${status}`,
    location: { '@type': 'Place', name: m.venue, address: { '@type': 'PostalAddress', addressCountry: 'NG' } },
    homeTeam: { '@type': 'SportsTeam', name: m.home_team }, awayTeam: { '@type': 'SportsTeam', name: m.away_team },
    organizer: { '@type': 'SportsOrganization', name: 'Nigeria National League' },
    url: `https://lobistarsfc.com/matches/${m.slug || matchSlug(m)}/`,
  }).replace(/</g, '\\u003c')}</script>`;
}

function card(m, big, previews = {}) {
  const home = typeof m.is_home === 'boolean' ? m.is_home : isLobi(m.home_team);
  const live = LIVE.includes(m.status);
  const slug = m.slug || matchSlug(m);
  const date = new Date(m.event_date).toLocaleDateString('en-GB', { weekday: big ? 'long' : 'short', day: 'numeric', month: big ? 'long' : 'short', timeZone: TZ });
  const time = new Date(m.event_date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
  const label = [m.matchday ? `Matchday ${m.matchday}` : null, m.competition].filter(Boolean).join(' · ');
  let when;
  if (live) when = `<span class="nm-live-badge"><span class="nm-pulse" aria-hidden="true"></span>LIVE${Number.isInteger(m.home_score) ? ` ${esc(m.home_score)}–${esc(m.away_score)}` : ''}</span>`;
  else if (m.status === 'postponed') when = '<span class="nm-postponed">Postponed – date to be confirmed</span>';
  else when = `${esc(date)} · <b>${esc(time)} WAT</b>`;
  const preview = previews[new Date(Date.parse(m.event_date) + 3600e3).toISOString().slice(0, 10)];
  const team = n => `<span class="nm-team">${crest(n, big ? 64 : 40)}<span>${esc(n)}</span></span>`;
  return `<li class="nm-card${big ? ' nm-card--next' : ''}${live ? ' is-live' : ''}">
<div class="nm-top"><span class="nm-md">${esc(label)}</span><span class="nm-ha ${home ? 'home' : 'away'}">${home ? 'HOME' : 'AWAY'}</span></div>
<div class="nm-teams">${team(m.home_team)}<span class="nm-vs" aria-hidden="true">vs</span>${team(m.away_team)}</div>
<div class="nm-when">${when}</div>
<div class="nm-venue">${esc(m.venue)}</div>
${big && !live && m.status !== 'postponed' ? `<p class="nm-cd" data-countdown="${esc(m.event_date)}" aria-live="off"></p>` : ''}
<div class="nm-links">${ticketHtml(m, home)}<a class="nm-link" href="/matches/${esc(slug)}/">Match Centre</a>${preview ? `<a class="nm-link" href="/news/${esc(preview)}/">Match preview</a>` : ''}${m.status !== 'postponed' ? `<a class="nm-link" href="/api/calendar?match=${encodeURIComponent(slug)}">Add to calendar</a>` : ''}<a class="nm-link" href="/commentary/" data-track="commentary_click" data-track-label="${esc(slug)}" aria-label="Listen live to ${esc(m.home_team)} vs ${esc(m.away_team)} on Lobi Stars FC Live">Listen live</a></div>
${jsonLd(m)}</li>`;
}

/** The cards (HTML list items) for the Lobi Stars matches in `matches`. */
export function upcomingHtml(matches, { now = Date.now(), previews = {}, limit = 3 } = {}) {
  const list = upcomingMatches(matches.filter(m => isLobi(m.home_team) || isLobi(m.away_team)), now).slice(0, limit);
  if (!list.length) return '<li class="nm-empty">Fixtures for the next round will be announced soon. <a href="/fixtures/">See all fixtures</a></li>';
  return list.map((m, i) => card(m, i === 0, previews)).join('');
}
