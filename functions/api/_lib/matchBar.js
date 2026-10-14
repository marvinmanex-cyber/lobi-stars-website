// The homepage match bar: the next Lobi Stars match as one slim strip under
// the hero (src/components/news/MatchBar.astro), not a second hero. Built on
// the server for every homepage request (functions/index.js). The match is
// matchBarMatch() (rules.js), the same next match as the programme strip.
//   [HOME · MATCHDAY 1] [crest] Lobi Stars FC VS Bichi First FC [crest]
//   | Sun 8 Nov | 4:00 PM | McCarthy Stadium, Makurdi, Benue State |
//   | Kick-off in 25d 05h 42m | [Buy ticket from ₦1,000] [More ▾]
// One main button: Buy ticket (home match on sale), Listen live (live match),
// otherwise Match Centre. The other actions are in the "More" menu.
import { TEAM_LOGOS } from './teamLogos.js';
import { matchSlug } from './matchSlug.js';
import { matchBarMatch, naira } from './tickets/rules.js';
import { crestHtml, lagosParts, esc } from './fixtureCard.js';
import { jsonLd } from './tickets/upcomingHtml.js';

const isLobi = n => /lobi stars/i.test(n || '');
const LIVE = ['live', 'half-time', 'half_time'];

const team = (name, side) => `<span class="mb-team mb-team--${side}">${crestHtml(name, TEAM_LOGOS[name] || null, 44)}<span class="mb-name">${esc(name)}</span></span>`;

/** The countdown (same markup hooks as the match cards, so src/lib/fixtureCards.ts runs it). */
function countdown(iso) {
  const tile = (u, label, hidden = false) => `<span class="mb-tile" data-u="${u}"${hidden ? ' hidden' : ''}><b class="fx-num">--</b><small>${label}</small></span>`;
  return `<div class="mb-cd" data-fx-cd="${esc(new Date(Date.parse(iso)).toISOString())}">
<div class="fx-cd-live" hidden><span class="mb-live"><span class="mb-pulse" aria-hidden="true"></span>LIVE</span></div>
<div class="fx-cd-js" hidden><span class="mb-cd-h">Kick-off in</span><span class="fx-tiles mb-tiles" role="timer" aria-live="off">${tile('d', 'd')}${tile('h', 'h')}${tile('m', 'm')}${tile('s', 's', true)}</span></div>
<span class="fx-cd-plain"></span></div>`;
}

/** The bar's inside (escaped), or '' when there is no match left (the bar stays hidden). */
export function matchBarHtml(matches, { now = Date.now() } = {}) {
  const m = matchBarMatch(matches, now);
  if (!m) return '';
  const home = typeof m.is_home === 'boolean' ? m.is_home : isLobi(m.home_team);
  const live = LIVE.includes(m.status);
  const postponed = m.status === 'postponed';
  const slug = m.slug || matchSlug(m);
  const p = lagosParts(m.event_date);
  const t = m.ticket || { state: m.on_sale ? 'on_sale' : 'not_on_sale' };
  const title = `${m.home_team} vs ${m.away_team}`;

  const centre = `/matches/${esc(slug)}/`;
  const listen = (cls, role) => `<a class="${cls}" href="/commentary/"${role} data-track="commentary_click" data-track-label="${esc(slug)}" aria-label="Listen live to ${esc(title)} on Lobi Stars FC Live">${cls.includes('mb-btn') ? '<span class="mb-live-dot" aria-hidden="true"></span>' : ''}Listen live</a>`;
  let primary;
  if (live) primary = listen('mb-btn mb-btn--primary', '');
  else if (home && !postponed && t.state === 'on_sale') primary = `<a class="mb-btn mb-btn--primary" href="/tickets/?event=${encodeURIComponent(m.id)}">Buy ticket${t.fromKobo ? ` <small>from ${esc(naira(t.fromKobo))}</small>` : ''}</a>`;
  else primary = `<a class="mb-btn mb-btn--primary" href="${centre}">Match Centre</a>`;
  const item = html => `<li role="none">${html}</li>`;
  const more = [];
  if (!primary.includes(`href="${centre}"`)) more.push(item(`<a role="menuitem" href="${centre}">Match Centre</a>`));
  if (!postponed && p) more.push(item(`<a role="menuitem" href="/api/calendar?match=${encodeURIComponent(slug)}">Add to calendar</a>`));
  more.push(item(`<button type="button" role="menuitem" data-fx-share data-url="${centre}" data-title="${esc(title)}">Share</button>`));
  if (!live) more.push(item(listen('', ' role="menuitem"')));

  const mid = live && Number.isInteger(m.home_score) && Number.isInteger(m.away_score)
    ? `<span class="mb-score" aria-label="Score ${esc(m.home_score)} to ${esc(m.away_score)}">${esc(m.home_score)}<span aria-hidden="true">–</span>${esc(m.away_score)}</span>`
    : '<span class="mb-vs" aria-hidden="true">VS</span>';
  let status;
  if (live) status = `<div class="mb-cd"><span class="mb-live"><span class="mb-pulse" aria-hidden="true"></span>${m.status === 'live' ? 'LIVE' : 'Half time'}</span></div>`;
  else if (postponed) status = '<div class="mb-cd"><span class="mb-pp">Postponed – date to be confirmed</span></div>';
  else status = p ? countdown(m.event_date) : '';
  const when = postponed || !p
    ? '<dl class="mb-when"><div><dt class="mb-sr">Date</dt><dd>Date to be confirmed</dd></div></dl>'
    : `<dl class="mb-when"><div><dt class="mb-sr">Date</dt><dd><time datetime="${p.iso}">${esc(p.shortDate)}</time></dd></div><div><dt class="mb-sr">Kick-off</dt><dd><time datetime="${p.iso}">${esc(p.time)}</time></dd></div></dl>`;

  return `<div class="mb-card${live ? ' is-live' : ''}" role="group" aria-label="Next match: ${esc(title)}">
<div class="mb-main"><div class="mb-meta"><span class="mb-ha mb-ha--${home ? 'home' : 'away'}">${home ? 'Home' : 'Away'}</span>${m.matchday ? `<span class="mb-md">Matchday ${esc(m.matchday)}</span>` : `<span class="mb-md">${esc(m.competition || 'Next match')}</span>`}</div>
<div class="mb-teams">${team(m.home_team, 'h')}${mid}${team(m.away_team, 'a')}</div></div>
${when}
<p class="mb-venue"><span class="mb-sr">Venue: </span>${esc(m.venue || 'Venue to be confirmed')}</p>
${status}
<div class="mb-acts">${primary}<div class="mb-more"><button type="button" class="mb-btn mb-btn--more" aria-haspopup="true" aria-expanded="false" aria-controls="mbMenu">More <span aria-hidden="true">&#9662;</span></button><ul class="mb-menu" id="mbMenu" role="menu" aria-label="More for ${esc(title)}" hidden>${more.join('')}</ul></div></div>
${jsonLd(m)}</div>`;
}
