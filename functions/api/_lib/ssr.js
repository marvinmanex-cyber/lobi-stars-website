// Server-side rendering for pages whose content comes from the database
// (fixtures, results, streams, commentary). The static page is fetched from
// the build, the real content is written into it before it is sent, and the
// data is embedded as JSON so the browser can enhance it without a second
// request. Visitors therefore never see "Loading…", even without JavaScript.
//
// The HTML built here mirrors the cards the browser scripts build, using the
// same CSS classes.
import { TEAM_LOGOS } from './teamLogos.js';
import { listMatches, toSummary } from './matchCentre.js';
import { matchSlug } from './matchSlug.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TZ = 'Africa/Lagos';
const isLobi = name => /lobi stars/i.test(name || '');
export const fmtDate = (iso, long = false) => new Date(iso).toLocaleDateString('en-GB',
  long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }
       : { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
export const fmtTime = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) + ' WAT';
const monthKey = iso => new Date(iso).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: TZ });
const hasScore = m => m.home_score !== null && m.home_score !== undefined && m.away_score !== null && m.away_score !== undefined;
const STATUS_LABELS = { scheduled: 'Upcoming', live: 'Live', 'half-time': 'Half-time', 'full-time': 'Full-time', postponed: 'Postponed', cancelled: 'Cancelled' };

function initials(name) {
  const words = String(name).replace(/\b(FC|F\.C\.|United)\b/gi, '').trim().split(/\s+/).filter(Boolean);
  return (words.slice(0, 2).map(w => w[0]).join('') || String(name).charAt(0)).toUpperCase();
}
export function crestHtml(name, size = 30, cls = 'crest') {
  const src = TEAM_LOGOS[name];
  return src
    ? `<img class="${cls}" src="${esc(src)}" alt="${esc(name)} crest" loading="lazy" width="${size}" height="${size}">`
    : `<span class="${cls} ${cls}--initials" aria-hidden="true">${esc(initials(name))}</span>`;
}

/** All visible matches in the public summary shape (same as /api/matches). */
export async function publicMatches(env) {
  try {
    const rows = await listMatches(env.DB);
    return rows.map(r => toSummary(r, r));
  } catch { return []; }
}

/** A JSON data block that can't break out of its <script> tag. */
export function jsonScript(id, data) {
  return `<script type="application/json" id="${id}">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

/** Fetches the built page and applies HTMLRewriter handlers; embeds `data` as JSON scripts in <head>. */
export async function renderPage(request, env, assetPath, handlers = [], data = {}) {
  const shell = await env.ASSETS.fetch(new URL(assetPath, request.url));
  if (!shell.ok) return shell;
  const headers = new Headers(shell.headers);
  headers.set('Cache-Control', 'public, max-age=30');
  let rw = new HTMLRewriter();
  const json = Object.entries(data).map(([id, v]) => jsonScript(id, v)).join('');
  if (json) rw = rw.on('head', { element(el) { el.append(json, { html: true }); } });
  for (const [selector, handler] of handlers) rw = rw.on(selector, handler);
  return rw.transform(new Response(shell.body, { status: shell.status, headers }));
}

/** Handler that replaces an element's contents with HTML. */
export const fill = html => ({ element(el) { el.setInnerContent(html, { html: true }); } });

// ── Homepage "Next Matches" ──

function compAbbr(comp) {
  const first = comp.trim().split(/\s+/)[0] || '';
  return /^[A-Z]{2,5}$/.test(first) ? first : comp.split(/\s+/).map(w => w[0]).join('').slice(0, 4).toUpperCase();
}

export function upcomingLobi(matches, now = Date.now()) {
  return matches
    .filter(ev => (isLobi(ev.home_team) || isLobi(ev.away_team)) && ev.status !== 'full-time' && ev.status !== 'cancelled'
      && (ev.status === 'live' || ev.status === 'half-time' || new Date(ev.event_date).getTime() > now))
    .sort((a, b) => new Date(a.event_date) - new Date(b.event_date));
}

export function nextMatchesHtml(matches, now = Date.now()) {
  const upcoming = upcomingLobi(matches, now);
  if (!upcoming.length) return '<li class="nm-empty">Fixtures for the next round will be announced soon. <a href="/fixtures">See all fixtures</a></li>';
  return upcoming.map(ev => {
    const home = typeof ev.is_home === 'boolean' ? ev.is_home : isLobi(ev.home_team);
    const live = ev.status === 'live' || ev.status === 'half-time';
    const opponent = home ? ev.away_team : ev.home_team;
    const comp = ev.competition || 'NPFL';
    const slug = ev.slug || matchSlug(ev);
    const date = new Date(ev.event_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
    const time = new Date(ev.event_date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
    const crest = TEAM_LOGOS[opponent]
      ? `<img class="nm-crest" src="${esc(TEAM_LOGOS[opponent])}" alt="${esc(opponent)} crest" loading="lazy" width="44" height="44">`
      : `<span class="nm-crest nm-crest-fallback" aria-hidden="true">${esc(opponent.charAt(0))}</span>`;
    return `<li class="nm-card">
<div class="nm-top"><span class="nm-comp-logo" aria-hidden="true">${esc(compAbbr(comp))}</span><div class="nm-comp"><span class="nm-comp-name">${esc(comp)}</span><span class="nm-venue">${esc(ev.venue)}</span></div></div>
<div class="nm-when">${live ? '<span class="nm-live-badge">Live now</span>' : `${esc(date)} · <b>${esc(time)} WAT</b>`}</div>
<div class="nm-opp">${crest}<span class="nm-opp-name">${esc(opponent)}</span><span class="nm-ha ${home ? 'home' : 'away'}">${home ? 'Home' : 'Away'}</span></div>
<div class="nm-links"><a class="nm-link" href="/matches/${esc(slug)}/" aria-label="Match Centre: Lobi Stars FC vs ${esc(opponent)}">Match Centre →</a>${home ? `<a class="nm-link nm-link--live" href="/matches/${esc(slug)}/live/" aria-label="Matchday Live: Lobi Stars FC vs ${esc(opponent)}">● Matchday Live</a>` : ''}<a class="nm-link nm-link--cal" href="/api/calendar?match=${encodeURIComponent(slug)}" aria-label="Add Lobi Stars FC vs ${esc(opponent)} to your calendar">📅 Add to calendar</a><a class="nm-link nm-link--listen" href="/commentary/" data-track="commentary_click" data-track-label="${esc(slug)}" aria-label="Listen live to Lobi Stars FC vs ${esc(opponent)} on Lobi Stars FC Live">🎧 Listen Live</a></div>
</li>`;
  }).join('');
}

// ── Fixtures / results board ──

const DAY = 86_400_000;
const norm = s => String(s).toLowerCase().replace(/\bfc\b|[^a-z]/g, '');
const same = (a, b) => norm(a.home_team) === norm(b.home_team) && norm(a.away_team) === norm(b.away_team)
  && Math.abs(new Date(a.event_date) - new Date(b.event_date)) < 3 * DAY;

/** Same merge + filter as the browser: database matches plus CMS fixtures. */
export function boardItems(db, cms, show, now = Date.now()) {
  const merged = [...db, ...cms.filter(c => !db.some(d => same(d, c)))].filter(m => m.status !== 'cancelled');
  const isPast = m => m.status === 'full-time' || (hasScore(m) && m.status !== 'live') || new Date(m.event_date).getTime() <= now;
  const upcoming = show === 'upcoming';
  return merged.filter(m => (upcoming ? !isPast(m) : isPast(m)))
    .sort((x, y) => (new Date(x.event_date) - new Date(y.event_date)) * (upcoming ? 1 : -1));
}

function googleCalUrl(m) {
  const d = iso => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const end = new Date(new Date(m.event_date).getTime() + 2 * 3600e3).toISOString();
  const q = new URLSearchParams({ action: 'TEMPLATE', text: `${m.home_team} vs ${m.away_team}`, dates: `${d(m.event_date)}/${d(end)}`, details: `${m.competition}`, location: m.venue || '' });
  return `https://calendar.google.com/calendar/render?${q}`;
}

function fixtureCard(m, upcoming) {
  const lobiHome = typeof m.is_home === 'boolean' ? m.is_home : isLobi(m.home_team);
  const lobiInvolved = lobiHome || isLobi(m.away_team);
  let mid;
  if (upcoming) mid = `<div class="fx-mid">${m.status === 'postponed' ? 'P–P' : 'VS'}</div>`;
  else if (hasScore(m)) mid = `<div class="fx-score">${esc(m.home_score)} – ${esc(m.away_score)}</div>`;
  else mid = `<div class="fx-pending">${esc(m.status && m.status !== 'scheduled' && m.status !== 'full-time' ? STATUS_LABELS[m.status] : 'Result pending')}</div>`;
  const vs = `${esc(m.home_team)} vs ${esc(m.away_team)}`;
  const actions = [];
  if (m.slug) actions.push(`<a class="fx-btn" href="/matches/${esc(m.slug)}/" aria-label="Match Centre: ${vs}">Match Centre</a>`);
  if (lobiHome && m.slug) actions.push(`<a class="fx-btn primary" href="/matches/${esc(m.slug)}/live/" aria-label="Matchday Live: ${vs}">● Matchday Live</a>`);
  if (!lobiHome && lobiInvolved && upcoming && m.status !== 'postponed') actions.push(`<a class="fx-btn" href="/commentary/" aria-label="Listen live to ${vs} on Lobi Stars FC Live">🎧 Listen Live</a>`);
  if (upcoming && lobiHome && m.id) actions.push(`<a class="fx-btn primary" href="/tickets?event=${encodeURIComponent(m.id)}" aria-label="Buy tickets: ${vs}">Buy Tickets</a>`);
  if (upcoming && m.slug) actions.push(`<a class="fx-btn" href="/api/calendar?match=${encodeURIComponent(m.slug)}">📅 Add to calendar (.ics)</a>`);
  if (upcoming) actions.push(`<a class="fx-btn" href="${esc(googleCalUrl(m))}" target="_blank" rel="noopener">Google Calendar</a>`);
  return `<article class="fx">
<div class="fx-meta"><span class="fx-comp">${esc(m.competition)}</span>${lobiInvolved ? `<span class="fx-ha ${lobiHome ? 'home' : 'away'}">${lobiHome ? 'Home' : 'Away'}</span>` : ''}<span class="fx-when">${esc(fmtDate(m.event_date))} · ${esc(fmtTime(m.event_date))}</span></div>
<div class="fx-teams"><div class="fx-team h"><span>${esc(m.home_team)}</span>${crestHtml(m.home_team, 34)}</div>${mid}<div class="fx-team">${crestHtml(m.away_team, 34)}<span>${esc(m.away_team)}</span></div></div>
<div class="fx-venue">📍 ${esc(m.venue)}</div>${actions.length ? `<div class="fx-actions">${actions.join('')}</div>` : ''}
</article>`;
}

export function boardHtml(items, show) {
  if (!items.length) return { status: show === 'upcoming' ? 'Fixtures for the next round will be announced soon.' : 'No results yet this season.', list: '' };
  let month = '', out = '';
  for (const m of items) {
    const k = monthKey(m.event_date);
    if (k !== month) { month = k; out += `<h2 class="fx-month">${esc(k)}</h2>`; }
    out += fixtureCard(m, show === 'upcoming');
  }
  return { status: '', list: out };
}

/**
 * Renders a fixtures/results board page. The board's CMS fixtures live in its
 * data-cms attribute, so they're read as the page streams past.
 */
export async function renderBoardPage(request, env, assetPath) {
  const matches = await publicMatches(env);
  let cms = [], show = 'upcoming';
  return renderPage(request, env, assetPath, [
    ['[data-fixtures-board]', { element(el) {
      show = el.getAttribute('data-show') || 'upcoming';
      try { cms = JSON.parse(el.getAttribute('data-cms') || '[]'); } catch { cms = []; }
    } }],
    ['[data-fixtures-board] [data-status]', { element(el) {
      const r = boardHtml(boardItems(matches, cms, show), show);
      if (r.status) el.setInnerContent(r.status); else el.setAttribute('hidden', '');
    } }],
    ['[data-fixtures-board] [data-list]', { element(el) { el.setInnerContent(boardHtml(boardItems(matches, cms, show), show).list, { html: true }); } }],
  ], { 'ssr-matches': { matches } });
}

// ── Watch Live page ──

const day = (iso, opts) => new Date(iso).toLocaleDateString('en-GB', { ...opts, timeZone: TZ });
const isLive = m => m.status === 'live' || m.status === 'half-time';

export function watchHtml(matches) {
  const home = matches.filter(m => m.is_home);
  const upcoming = home.filter(m => ['scheduled', 'live', 'half-time'].includes(m.status)).slice(0, 6);
  const schedule = upcoming.length ? upcoming.map(m => `<div class="wv-item">
<div class="wv-date"><b>${esc(day(m.event_date, { day: 'numeric' }))}</b><span>${esc(day(m.event_date, { month: 'short' }))}</span></div>
<div><div class="wv-teams">${crestHtml(m.home_team, 32)}${esc(m.home_team)} vs ${esc(m.away_team)}${isLive(m) ? '<span class="wv-live">Live now</span>' : ''}</div>
<span class="wv-meta">${isLive(m) ? 'Streaming now' : `${esc(day(m.event_date, { weekday: 'long' }))} · Live from kick-off, ${esc(fmtTime(m.event_date))}`}</span></div>
<div class="wv-acts"><a class="btn-p" href="/matches/${esc(m.slug)}/live#watch">${isLive(m) ? '▶ Watch live' : '▶ Watch'}</a><a class="btn-o" href="/commentary/">🎧 Listen</a></div>
</div>`).join('') : '<p class="wv-empty">Fixtures for the next round will be announced soon.</p>';
  const finished = home.filter(m => m.status === 'full-time' && hasScore(m)).reverse();
  const f = finished[0];
  const last = f ? `<div><span class="wv-last-k">Last result</span><strong>Final score: ${esc(f.home_team)} ${esc(f.home_score)} : ${esc(f.away_score)} ${esc(f.away_team)}</strong></div>`
    + (f.has_stream ? `<a class="btn-o" href="/matches/${esc(f.slug)}/live#watch">▶ Full match replay</a>` : `<a class="btn-o" href="/matches/${esc(f.slug)}/">Match report</a>`) : '';
  const replays = finished.filter(m => m.has_stream).slice(0, 12).map(m => `<a href="/matches/${esc(m.slug)}/live#watch"><span class="wv-rp-score">${esc(m.home_team)} ${esc(m.home_score)}–${esc(m.away_score)} ${esc(m.away_team)}</span><span class="wv-rp-meta">${esc(day(m.event_date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</span><span class="wv-rp-go">Watch replay →</span></a>`).join('');
  return { schedule, last, replays };
}

// ── Homepage "FULL TIME" banner (24 hours after a Lobi Stars match) ──

/**
 * HTML for the slim full-time banner, or '' when no Lobi Stars match finished
 * in the last 24 hours. Links only appear when their content exists.
 */
export async function fullTimeBannerHtml(env, now = Date.now()) {
  try {
    const rows = await listMatches(env.DB);
    const recent = rows
      .filter(r => r.status === 'full-time' && r.ended_at && (isLobi(r.home_team) || isLobi(r.away_team)) && hasScore(r)
        && now - new Date(r.ended_at).getTime() < 24 * 3600_000 && now >= new Date(r.ended_at).getTime())
      .sort((a, b) => new Date(b.ended_at) - new Date(a.ended_at))[0];
    if (!recent) return '';
    const m = toSummary(recent, recent);
    const centre = await env.DB.prepare(`SELECT report FROM match_centre WHERE event_id = ?`).bind(recent.id).first();
    let votes = 0;
    if (m.is_home) {
      const t = await env.DB.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'motm_votes'`).first();
      if (t) votes = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM motm_votes WHERE event_id = ?`).bind(recent.id).first()).n || 0;
    }
    const short = n => String(n).replace(/\s+FC$/i, '');
    const links = [];
    if ((centre?.report || '').trim()) links.push(`<a href="/matches/${esc(m.slug)}/">Report</a>`);
    if (m.has_stream) links.push(`<a href="/matches/${esc(m.slug)}/live#watch">Highlights</a>`);
    if (votes > 0) links.push(`<a href="/matches/${esc(m.slug)}/live#vote">Man of the Match</a>`);
    if (!links.length) links.push(`<a href="/matches/${esc(m.slug)}/">Match Centre</a>`);
    return `<strong>Full time:</strong> ${esc(short(m.home_team))} ${esc(m.home_score)}–${esc(m.away_score)} ${esc(short(m.away_team))} <span class="ftb-sep">–</span> ${links.join('<span class="ftb-sep">|</span>')}`;
  } catch { return ''; }
}
