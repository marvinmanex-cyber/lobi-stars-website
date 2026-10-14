// One match card for /fixtures, /results and the homepage "Upcoming Matches"
// (and the details block on the Match Centre). Pure string building: used on
// the server and in the browser, so every place shows a match the same way.
// Styles: src/styles/fixture-card.css. Countdown script: src/lib/fxCountdown.ts.
// Times are stored in UTC and shown in Nigerian time (Africa/Lagos, UTC+1 all
// year); the full ISO time with its offset stays in <time datetime> and JSON-LD.

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Nigerian date and time parts of a UTC ISO time, or null. */
export function lagosParts(iso) {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return null;
  const d = new Date(t + 3600e3);
  const h = d.getUTCHours(), mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ymd = d.toISOString().slice(0, 10), hm = d.toISOString().slice(11, 16);
  return {
    ymd, hm, iso: `${ymd}T${hm}:00+01:00`,
    date: `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
    shortDate: `${DAYS[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}`,
    time: `${h % 12 || 12}:${mi} ${h < 12 ? 'AM' : 'PM'}`,
  };
}

/** "McCarthy Stadium, Makurdi, Benue State" -> { name: 'McCarthy Stadium', place: 'Makurdi, Benue State' }. */
export function splitVenue(v) {
  const s = String(v || '').trim();
  const i = s.indexOf(',');
  return i < 0 ? { name: s, place: '' } : { name: s.slice(0, i).trim(), place: s.slice(i + 1).trim() };
}

/** Club initials for the monogram: "Lobi Stars FC" -> "LS". */
export function initials(name) {
  const words = String(name || '?').replace(/\b(FC|F\.C\.|SC|United Football Club)\b/gi, '').trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
}

const svg = body => `<svg class="fx-ico" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICON = {
  date: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  time: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  venue: svg('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
};

/** A crest image (fixed size, lazy) or a monogram circle when there is no crest. */
export function crestHtml(name, src, size) {
  const box = `width:${size}px;height:${size}px`;
  if (!src) return `<span class="fx-crest fx-crest--mono" style="${box};font-size:${Math.round(size * 0.36)}px" aria-hidden="true">${esc(initials(name))}</span>`;
  return `<img class="fx-crest" src="${esc(src)}" alt="${esc(name)} crest" width="${size}" height="${size}" loading="lazy" decoding="async" style="${box}">`;
}

/**
 * Date, kick-off and venue as three separate details (<dl>).
 * `tbc` (postponed / no date): the date and time read "To be confirmed".
 */
export function detailsHtml({ kickoff, venue, tbc = false } = {}) {
  const p = tbc ? null : lagosParts(kickoff);
  const v = splitVenue(venue);
  const item = (key, label, value) => `<div class="fx-d fx-d--${key}"><dt>${ICON[key]}<span>${label}</span></dt><dd>${value}</dd></div>`;
  return `<dl class="fx-details">${
    item('date', 'Date', p ? `<time datetime="${p.iso}">${esc(p.date)}</time>` : 'To be confirmed')}${
    item('time', 'Kick-off', p ? `<time datetime="${p.iso}">${esc(p.time)}</time>` : 'TBC')}${
    item('venue', 'Venue', v.name ? `<span class="fx-vn">${esc(v.name)}</span>${v.place ? `<span class="fx-vp">${esc(v.place)}</span>` : ''}` : 'To be confirmed')}</dl>`;
}

/**
 * The countdown tiles (Days, Hours, Minutes, and Seconds under 24 hours when
 * `seconds`). Without JavaScript the plain date and time show instead.
 */
export function countdownHtml(kickoff, { seconds = false } = {}) {
  const p = lagosParts(kickoff);
  if (!p) return '';
  const tile = (unit, label, hidden = false) => `<div class="fx-tile"${hidden ? ' hidden' : ''} data-u="${unit}"><span class="fx-num">--</span><span class="fx-unit">${label}</span></div>`;
  return `<div class="fx-cd" data-fx-cd="${esc(new Date(Date.parse(kickoff)).toISOString())}"${seconds ? ' data-secs' : ''}>
<div class="fx-cd-live" hidden><span class="fx-live"><span class="fx-pulse" aria-hidden="true"></span>LIVE</span></div>
<div class="fx-cd-js" hidden><p class="fx-cd-h">Kick-off in</p><div class="fx-tiles" role="timer" aria-live="off">${tile('d', 'Days')}${tile('h', 'Hours')}${tile('m', 'Minutes')}${seconds ? tile('s', 'Seconds', true) : ''}</div></div>
<p class="fx-cd-plain">Kick-off: <time datetime="${p.iso}">${esc(p.date)}, ${esc(p.time)}</time></p></div>`;
}

const LIVE = ['live', 'half_time', 'half-time'];
const DONE = ['full_time', 'full-time', 'awarded'];

/** "Nigeria National League, Conference D" -> "Nigeria National League · Conference D". */
export const compLabel = s => String(s || '').replace(/,\s*/g, ' · ');

/**
 * One match card. `c` = {
 *   id, home: { name, crest, isLobi }, away: {...}, kickoff (UTC ISO), venue (text),
 *   status, homeGoals, awayGoals, matchday, competition, featured, seconds,
 *   chips: [html], notes: [html], actions: [html], jsonLd (html), tag ('article'|'li'), attrs (html)
 * }
 */
export function fixtureCardHtml(c) {
  const live = LIVE.includes(c.status);
  const done = DONE.includes(c.status) && Number.isInteger(c.homeGoals) && Number.isInteger(c.awayGoals);
  const postponed = c.status === 'postponed';
  const off = ['cancelled', 'abandoned'].includes(c.status);
  const lobiSide = c.home?.isLobi ? 'home' : c.away?.isLobi ? 'away' : '';
  const winner = done ? (c.homeGoals > c.awayGoals ? 'h' : c.homeGoals < c.awayGoals ? 'a' : '') : '';
  const featured = !!c.featured;
  const size = featured ? 96 : 60;
  const tag = c.tag || 'article';
  const cls = ['fx-card', featured ? 'fx-card--featured' : 'fx-card--regular', lobiSide ? `fx-card--${lobiSide}` : 'fx-card--neutral', done ? 'fx-card--done' : '', live ? 'is-live' : '', postponed ? 'is-postponed' : ''].filter(Boolean).join(' ');

  let mid;
  if (done || live) mid = `<div class="fx-score" data-score aria-label="Score ${esc(c.homeGoals ?? 0)} to ${esc(c.awayGoals ?? 0)}">${esc(c.homeGoals ?? 0)}<span aria-hidden="true">–</span>${esc(c.awayGoals ?? 0)}</div>`;
  else if (postponed) mid = '<div class="fx-vs fx-vs--pp">P–P</div>';
  else mid = '<div class="fx-vs" aria-hidden="true">VS</div>';

  const team = (t, side) => `<div class="fx-team fx-team--${side}${winner === side[0] ? ' won' : ''}">${crestHtml(t?.name, t?.crest, size)}<span class="fx-name">${esc(t?.name)}</span></div>`;

  // Featured card: the countdown, or LIVE, the final score, or "Postponed".
  let status = '';
  if (featured) {
    if (live) status = `<div class="fx-cd"><div class="fx-cd-live"><span class="fx-live" data-status><span class="fx-pulse" aria-hidden="true"></span>${c.status === 'half_time' || c.status === 'half-time' ? 'Half time' : 'LIVE'}</span></div></div>`;
    else if (done) status = `<div class="fx-cd"><p class="fx-final">Full time: ${esc(c.home?.name)} ${esc(c.homeGoals)}–${esc(c.awayGoals)} ${esc(c.away?.name)}</p></div>`;
    else if (postponed) status = '<div class="fx-cd"><p class="fx-pp">Postponed – date to be confirmed</p></div>';
    else if (!off && c.kickoff) status = countdownHtml(c.kickoff, { seconds: c.seconds !== false });
  } else if (postponed) status = '<div class="fx-cd"><p class="fx-pp">Postponed – date to be confirmed</p></div>';

  const pills = [
    featured ? `<span class="fx-pill fx-pill--next">${live ? 'Live now' : 'Next match'}</span>` : '',
    lobiSide ? `<span class="fx-pill fx-pill--${lobiSide}">${lobiSide === 'home' ? 'Home' : 'Away'}</span>` : '',
    ...(c.chips || []),
  ].join('');
  const top = `<div class="fx-top"><div class="fx-labels">${c.matchday ? `<span class="fx-md">Matchday ${esc(c.matchday)}</span>` : ''}${c.competition ? `<span class="fx-comp">${esc(compLabel(c.competition))}</span>` : ''}</div>${pills ? `<div class="fx-pills">${pills}</div>` : ''}</div>`;

  return `<${tag} class="${cls}"${c.attrs ? ` ${c.attrs}` : ''}>
${top}
<div class="fx-teams">${team(c.home, 'h')}${mid}${team(c.away, 'a')}</div>
${detailsHtml({ kickoff: c.kickoff, venue: c.venue, tbc: postponed || !c.kickoff })}
${status}${c.notes?.length ? `<p class="fx-note">${c.notes.join(' ')}</p>` : ''}${c.actions?.length ? `<div class="fx-acts">${c.actions.join('')}</div>` : ''}
${c.jsonLd || ''}</${tag}>`;
}

/** The "Share" action: the site's share sheet (ShareButton script) or the phone's own share. */
export function shareAction(url, title) {
  return `<button type="button" class="fx-btn" data-fx-share data-url="${esc(url)}" data-title="${esc(title)}">Share</button>`;
}
