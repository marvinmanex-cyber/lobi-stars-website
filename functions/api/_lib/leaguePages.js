// Server-rendered HTML for /fixtures, /results and /table (real HTML for
// search engines and for visitors without JavaScript). Filters are ordinary
// GET parameters, so every view has its own address. Every value from the
// database is escaped.
import { tablePayload, matchdaySummary } from './leagueApi.js';
import { buildFormGuide, nextFixture, byKickoff, CRITERION_LABELS } from './league/standings.js';
import { formatDate, formatShortDate, formatDateTime, toLagos } from './league/time.js';
import { fixtureCardHtml, shareAction, splitVenue } from './fixtureCard.js';

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SITE = 'https://lobistarsfc.com';
const LIVE = ['live', 'half_time'];
const DONE = ['full_time', 'awarded'];
const STATUS_TEXT = { scheduled: 'Upcoming', live: 'LIVE', half_time: 'Half time', full_time: 'Full time', postponed: 'Postponed', abandoned: 'Abandoned', cancelled: 'Cancelled', awarded: 'Awarded' };
const monthLabel = ym => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const lagosMonth = iso => toLagos(iso)?.date.slice(0, 7) || '';

// Table crests: the shared logo rule (.club-logo), the crest exactly as designed.
const crest = (t, size = 26) => {
  if (!t?.crest_url && !t?.code) return `<span class="club-logo club-logo--mono lg-crest" style="--logo-h:${size}px" aria-hidden="true">${esc(String(t?.name || '?').trim().charAt(0))}</span>`;
  return `<img class="club-logo lg-crest" src="${esc(t.crest_url || `/api/league/crest/${t.code}`)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async" style="--logo-h:${size}px">`;
};
const crestUrl = t => t?.crest_url || (t?.code ? `/api/league/crest/${t.code}` : null);
const side = t => ({ name: t?.name, crest: crestUrl(t), colour: t?.colour, isLobi: !!t?.is_lobi });

/**
 * A unified match for the pages: league fixtures plus any Lobi Stars match in
 * Matches & Fixtures that isn't a league fixture (e.g. a friendly added there).
 */
export function extraMatches(events, league) {
  const linked = new Set(league.fixtures.map(f => f.event_id).filter(Boolean));
  const lobi = league.allTeams.find(t => t.is_lobi);
  const findTeam = name => league.allTeams.find(t => t.name === name || t.short_name === name || (t.aliases || []).includes(name));
  const fake = name => ({ id: 0, code: '', name, short_name: name, crest_url: null });
  return events.filter(e => !linked.has(e.id) && e.status !== 'cancelled').map(e => {
    const home = findTeam(e.home_team) || (/lobi stars/i.test(e.home_team) ? lobi : fake(e.home_team));
    const away = findTeam(e.away_team) || (/lobi stars/i.test(e.away_team) ? lobi : fake(e.away_team));
    const st = { 'half-time': 'half_time', 'full-time': 'full_time' }[e.status] || e.status;
    return {
      id: `e-${e.id}`, extra: true, event_id: e.id, slug: e.slug, competition: { short_name: e.competition, slug: 'other' }, matchday: null,
      home, away, home_team_id: home?.id, away_team_id: away?.id, venue: { name: e.venue }, kickoff_at: e.event_date, original_kickoff_at: e.event_date,
      status: st, home_goals: e.home_score ?? null, away_goals: e.away_score ?? null, on_sale: e.on_sale, note: null,
    };
  });
}

const matchUrl = f => {
  if (f.slug) return `/matches/${f.slug}/`;
  if (!f.event_id) return null;
  const iso = f.kickoff_at || f.original_kickoff_at;
  const part = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `/matches/${toLagos(iso).date}-${part(f.home?.name)}-vs-${part(f.away?.name)}/`;
};

/** "McCarthy Stadium, Makurdi, Benue State" -> { addressLocality: 'Makurdi', addressRegion: 'Benue State' }. */
function postalAddress(venue) {
  const [locality, region] = splitVenue(venue).place.split(',').map(x => x.trim());
  return { '@type': 'PostalAddress', ...(locality ? { addressLocality: locality } : {}), ...(region ? { addressRegion: region } : {}), addressCountry: 'NG' };
}

function jsonLd(f) {
  const status = { postponed: 'EventPostponed', cancelled: 'EventCancelled', abandoned: 'EventCancelled' }[f.status]
    || (f.original_kickoff_at && f.kickoff_at && f.original_kickoff_at !== f.kickoff_at ? 'EventRescheduled' : 'EventScheduled');
  const iso = f.kickoff_at || f.original_kickoff_at;
  const l = toLagos(iso);
  const d = {
    '@context': 'https://schema.org', '@type': 'SportsEvent', name: `${f.home?.name} vs ${f.away?.name}`, sport: 'Soccer',
    startDate: `${l.date}T${l.time}:00+01:00`, eventStatus: `https://schema.org/${status}`, eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: { '@type': 'Place', name: f.venue?.name || 'To be confirmed', address: postalAddress(f.venue?.name) },
    homeTeam: { '@type': 'SportsTeam', name: f.home?.name }, awayTeam: { '@type': 'SportsTeam', name: f.away?.name },
    organizer: { '@type': 'SportsOrganization', name: f.competition?.name || f.competition?.short_name || 'Nigeria National League' },
    url: `${SITE}${matchUrl(f) || '/fixtures/'}`,
  };
  if (f.original_kickoff_at && f.kickoff_at && f.original_kickoff_at !== f.kickoff_at) d.previousStartDate = `${toLagos(f.original_kickoff_at).date}T${toLagos(f.original_kickoff_at).time}:00+01:00`;
  return `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, '\\u003c')}</script>`;
}

function matchCard(f, { now = Date.now(), previews = {}, featured = false } = {}) {
  const lobiHome = !!f.home?.is_lobi, lobiAway = !!f.away?.is_lobi, lobi = lobiHome || lobiAway;
  const iso = f.kickoff_at || f.original_kickoff_at;
  const live = LIVE.includes(f.status);
  const done = DONE.includes(f.status) && Number.isInteger(f.home_goals);
  const rescheduled = f.kickoff_at && f.original_kickoff_at && f.kickoff_at !== f.original_kickoff_at;
  const chips = [];
  if (live && !featured) chips.push(`<span class="lg-chip live" data-status><span class="lg-pulse" aria-hidden="true"></span>${f.status === 'half_time' ? 'Half time' : 'LIVE'}</span>`);
  else if (done && !featured) chips.push('<span class="lg-chip">Full time</span>');
  else if (['cancelled', 'abandoned'].includes(f.status)) chips.push(`<span class="lg-chip bad">${STATUS_TEXT[f.status]}</span>`);
  else if (f.status === 'awarded') chips.push('<span class="lg-chip">Awarded</span>');
  else if (rescheduled && f.status !== 'postponed') chips.push('<span class="lg-chip info">Rescheduled</span>');
  const notes = [];
  if (f.status === 'postponed') notes.push(`Originally ${esc(formatShortDate(f.original_kickoff_at))}${f.postponed_reason ? `: ${esc(f.postponed_reason)}` : ''}.`);
  else if (rescheduled) notes.push(`Rescheduled from ${esc(formatShortDate(f.original_kickoff_at))}.`);
  if (f.note && !/^Postponed$|^Rescheduled from/.test(f.note)) notes.push(esc(f.note));
  if (f.result_type === 'awarded') notes.push('Result awarded by the league.');
  const acts = [];
  const mu = matchUrl(f);
  const upcoming = !done && !live && !['cancelled', 'abandoned'].includes(f.status) && f.status !== 'postponed';
  // Ticket state: Buy ticket / Sold out / not on sale yet (home), Away fixture (away).
  const ts = f.ticket?.state || (f.on_sale ? 'on_sale' : 'not_on_sale');
  if (upcoming && lobiHome && f.kickoff_at && Date.parse(f.kickoff_at) > now) {
    if (ts === 'on_sale') acts.push(`<a class="lg-btn primary" href="/tickets/?event=${encodeURIComponent(f.event_id)}">Buy ticket</a>`);
    else if (ts === 'sold_out') acts.push('<span class="lg-chip bad lg-tix">Sold out</span>');
    else if (ts === 'not_on_sale') acts.push('<span class="lg-chip lg-tix">Tickets not on sale yet</span>');
  } else if (upcoming && lobiAway) acts.push('<span class="lg-chip lg-tix">Away fixture</span>');
  if (featured && live && lobi) acts.push('<a class="lg-btn primary" href="/commentary/">Listen live</a>');
  if (mu) acts.push(`<a class="lg-btn" href="${esc(mu)}">${done ? 'Match report' : 'Match Centre'}</a>`);
  if (done && f.report_url) acts.push(`<a class="lg-btn" href="${esc(f.report_url)}">Report</a>`);
  const preview = iso ? previews[toLagos(iso).date] : null;
  if (upcoming && lobi && preview) acts.push(`<a class="lg-btn" href="/news/${esc(preview)}/">Match preview</a>`);
  if (upcoming && f.kickoff_at && !f.extra) acts.push(`<a class="lg-btn" href="/api/league/calendar.ics?fixture=${encodeURIComponent(f.id)}" download>Add to calendar</a>`);
  if (mu) acts.push(shareAction(mu, `${f.home?.name} vs ${f.away?.name}`));
  const winner = done ? (f.home_goals > f.away_goals ? f.home?.name : f.home_goals < f.away_goals ? f.away?.name : '') : '';
  const label = done ? `${f.home?.name} ${f.home_goals}, ${f.away?.name} ${f.away_goals}${winner ? `. ${winner} won` : '. A draw'}` : `${f.home?.name} vs ${f.away?.name}`;
  return fixtureCardHtml({
    home: side(f.home), away: side(f.away), kickoff: f.kickoff_at, venue: f.venue?.name, status: f.status,
    homeGoals: f.home_goals, awayGoals: f.away_goals, matchday: f.matchday, competition: f.competition?.name || f.competition?.short_name,
    featured, chips, notes, actions: acts, jsonLd: jsonLd(f),
    attrs: `data-id="${esc(f.id)}" data-lobi="${lobi ? 1 : 0}" data-md="${esc(f.matchday ?? '')}" data-month="${esc(lagosMonth(iso))}" data-ha="${lobiHome ? 'home' : lobiAway ? 'away' : ''}" data-comp="${esc(f.competition?.slug || '')}" aria-label="${esc(label)}"`,
  });
}

function select(name, label, options, value) {
  return `<label class="lg-f"><span>${esc(label)}</span><select name="${name}">${options.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(value ?? '') ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
}

// ── /fixtures ──

export function fixturesPage(league, extras, url, previews = {}) {
  const p = url.searchParams;
  const view = p.get('view') === 'all' ? 'all' : 'lobi';
  const md = /^\d{1,2}$/.test(p.get('matchday') || '') ? Number(p.get('matchday')) : null;
  const month = /^\d{4}-\d{2}$/.test(p.get('month') || '') ? p.get('month') : null;
  const ha = ['home', 'away'].includes(p.get('ha')) ? p.get('ha') : null;
  const comp = /^[a-z0-9-]{1,80}$/.test(p.get('comp') || '') ? p.get('comp') : null;
  const lobi = league.allTeams.find(t => t.is_lobi);
  const all = [...league.fixtures, ...extras].filter(f => !DONE.includes(f.status));
  const comps = [...new Map(all.map(f => [f.competition?.slug, f.competition?.short_name])).entries()].filter(([s]) => s);
  const months = [...new Set(all.map(f => lagosMonth(f.kickoff_at || f.original_kickoff_at)).filter(Boolean))].sort();
  const mds = [...new Set(league.fixtures.map(f => f.matchday).filter(Boolean))].sort((a, b) => a - b);
  let list = all;
  const isLobi = f => !!(f.home?.is_lobi || f.away?.is_lobi);
  if (view === 'lobi') list = list.filter(isLobi);
  else list = list.filter(f => !f.extra);
  if (md) list = list.filter(f => f.matchday === md);
  if (month) list = list.filter(f => lagosMonth(f.kickoff_at || f.original_kickoff_at) === month);
  if (ha) list = list.filter(f => (ha === 'home' ? f.home?.is_lobi : f.away?.is_lobi));
  if (comp) list = list.filter(f => f.competition?.slug === comp);
  list.sort((a, b) => byKickoff(a, b));

  const next = lobi ? nextFixture(lobi.id, [...league.fixtures, ...extras]) : null;
  const filters = `<form class="lg-filters" method="get" action="/fixtures/" data-autosubmit>
<div class="lg-switch" role="group" aria-label="Show"><a href="/fixtures/" ${view === 'lobi' ? 'aria-current="page"' : ''}>Lobi Stars</a><a href="/fixtures/?view=all" ${view === 'all' ? 'aria-current="page"' : ''}>All Conference D</a></div>
<input type="hidden" name="view" value="${view}">
${select('matchday', 'Matchday', [['', 'All'], ...mds.map(d => [d, `Matchday ${d}`])], md)}
${select('month', 'Month', [['', 'All'], ...months.map(m => [m, monthLabel(m)])], month)}
${view === 'lobi' ? select('ha', 'Home or away', [['', 'Both'], ['home', 'Home'], ['away', 'Away']], ha) : ''}
${comps.length > 1 ? select('comp', 'Competition', [['', 'All'], ...comps], comp) : ''}
<button type="submit" class="lg-btn" data-apply>Show</button>
</form>`;

  // The next Lobi Stars match leads the page as the featured card (unfiltered views).
  const filtered = !!(md || month || ha || comp);
  const featured = !filtered && next ? next : null;
  if (featured) list = list.filter(f => f.id !== featured.id);
  let body = '';
  if (!list.length && !featured) body = `<p class="lg-empty">No matches to show${filtered ? ' with these filters. <a href="/fixtures/">Show all Lobi Stars fixtures</a>' : '. Fixtures for the next round will be announced soon.'}</p>`;
  else {
    const brk = league.competition.break_start ? { start: league.competition.break_start, end: league.competition.break_end, label: league.competition.break_label || 'Mid-season break' } : null;
    let lastDay = '', lastMd = null, breakShown = false, open = false;
    for (const f of list) {
      const iso = f.kickoff_at || f.original_kickoff_at;
      const day = toLagos(iso)?.date || ''; // date to be confirmed: no day
      // The mid-season break sits between the last match before it and the first after it.
      if (brk && !breakShown && lastDay && lastDay < brk.start && day >= brk.start) {
        if (open) { body += '</div>'; open = false; }
        body += `<div class="lg-break" role="separator">${esc(brk.label)}, ${esc(formatShortDate(`${brk.start}T12:00:00Z`).replace(/^\w+ /, ''))} to ${esc(formatShortDate(`${brk.end}T12:00:00Z`).replace(/^\w+ /, ''))}</div>`;
        breakShown = true;
      }
      // Cards are grouped under their matchday (other matches under their date).
      const group = f.matchday ? `md${f.matchday}` : `d${day}`;
      if (group !== lastMd || !open) {
        if (open) body += '</div>';
        body += `<h2 class="lg-md">${f.matchday ? `Matchday ${esc(f.matchday)}` : esc(formatDate(iso))}</h2><div class="lg-group">`;
        open = true; lastMd = group;
      }
      lastDay = day;
      body += matchCard(f, { previews });
    }
    if (open) body += '</div>';
  }
  const feed = `<aside class="lg-sub"><div><h2>Never miss a match</h2><p>Subscribe to the Lobi Stars fixtures: kick-off changes and new dates appear in your calendar automatically.</p></div>
<div class="lg-acts"><a class="lg-btn primary" href="webcal://lobistarsfc.com/api/league/calendar.ics?team=lobi" data-webcal>Subscribe to Lobi Stars fixtures</a><a class="lg-btn" href="https://calendar.google.com/calendar/r?cid=${encodeURIComponent('webcal://lobistarsfc.com/api/league/calendar.ics?team=lobi')}" target="_blank" rel="noopener">Google Calendar</a><a class="lg-btn" href="/api/league/calendar.ics?team=lobi">Download (.ics)</a></div></aside>`;
  const top = featured ? `<div class="lg-featured">${matchCard(featured, { previews, featured: true })}</div>` : '';
  return `${top}${filters}<div class="lg-list" data-live-list>${body}</div>${feed}`;
}

// ── /results ──

export function resultsPage(league, extras, url) {
  const p = url.searchParams;
  const teamQ = (p.get('team') || 'lobi').toLowerCase();
  const md = /^\d{1,2}$/.test(p.get('matchday') || '') ? Number(p.get('matchday')) : null;
  const lobi = league.allTeams.find(t => t.is_lobi);
  const team = teamQ === 'all' ? null : league.allTeams.find(t => (teamQ === 'lobi' && t.is_lobi) || t.code.toLowerCase() === teamQ || t.slug === teamQ) || lobi;
  let list = [...league.fixtures, ...extras].filter(f => DONE.includes(f.status) && Number.isInteger(f.home_goals) && Number.isInteger(f.away_goals));
  if (team) list = list.filter(f => f.home_team_id === team.id || f.away_team_id === team.id || (team.is_lobi && (f.home?.is_lobi || f.away?.is_lobi)));
  else list = list.filter(f => !f.extra);
  if (md) list = list.filter(f => f.matchday === md);
  list.sort((a, b) => byKickoff(b, a));
  const mds = [...new Set(league.fixtures.map(f => f.matchday).filter(Boolean))].sort((a, b) => a - b);
  const form = lobi ? buildFormGuide(lobi.id, league.fixtures, league.competition) : [];
  const formHtml = `<section class="lg-form-guide" aria-labelledby="lg-form-h"><h2 id="lg-form-h">Lobi Stars form</h2>${form.length
    ? `<ol class="lg-form" aria-label="Last ${form.length} league results, oldest first">${form.map(x => `<li class="lg-f-${x.r}" title="${esc(`${x.fixture.home.name} ${x.fixture.home_goals}–${x.fixture.away_goals} ${x.fixture.away.name}`)}"><span aria-hidden="true">${x.r}</span><span class="sr">${x.r === 'W' ? 'Won' : x.r === 'D' ? 'Drew' : 'Lost'} ${esc(`${x.fixture.home.name} ${x.fixture.home_goals}–${x.fixture.away_goals} ${x.fixture.away.name}`)}</span></li>`).join('')}</ol><p class="lg-small">Last ${form.length} league matches, oldest first.</p>`
    : '<p class="lg-small">No league results yet this season.</p>'}</section>`;
  const filters = `<form class="lg-filters" method="get" action="/results/" data-autosubmit>
${select('team', 'Club', [['lobi', 'Lobi Stars'], ['all', 'All Conference D'], ...league.teams.filter(t => !t.is_lobi).map(t => [t.code.toLowerCase(), t.name])], team ? (team.is_lobi ? 'lobi' : team.code.toLowerCase()) : 'all')}
${select('matchday', 'Matchday', [['', 'All'], ...mds.map(d => [d, `Matchday ${d}`])], md)}
<button type="submit" class="lg-btn" data-apply>Show</button></form>`;
  const body = list.length ? `<div class="lg-group">${list.map(f => matchCard(f)).join('')}</div>` : `<p class="lg-empty">No results yet${md ? ' for this matchday' : ' this season'}. The season starts on ${esc(formatDate(`${league.competition.start_date}T12:00:00Z`))}.</p>`;
  return `${formHtml}${filters}<div class="lg-list">${body}</div>`;
}

// ── /table ──

export function tablePage(league, url) {
  const p = url.searchParams;
  const scope = ['home', 'away'].includes(p.get('scope')) ? p.get('scope') : 'overall';
  const upRaw = p.get('upto');
  const mds = [...new Set(league.fixtures.map(f => f.matchday).filter(Boolean))].sort((a, b) => a - b);
  const upTo = /^\d{1,2}$/.test(upRaw || '') && mds.includes(Number(upRaw)) ? Number(upRaw) : null;
  const t = tablePayload(league, { scope, upTo });
  const comp = league.competition;
  const qs = (o) => { const u = new URLSearchParams(); if (o.scope && o.scope !== 'overall') u.set('scope', o.scope); if (o.upto) u.set('upto', o.upto); const s = u.toString(); return `/table/${s ? `?${s}` : ''}`; };
  const tabs = `<nav class="lg-tabs" aria-label="Table">${['overall', 'home', 'away'].map(s => `<a href="${qs({ scope: s, upto: upTo })}" ${s === scope ? 'aria-current="page"' : ''}>${s[0].toUpperCase() + s.slice(1)}</a>`).join('')}</nav>`;
  const played = mds.filter(d => league.fixtures.some(f => f.matchday === d && DONE.includes(f.status)));
  const upto = `<form class="lg-filters" method="get" action="/table/" data-autosubmit>${scope !== 'overall' ? `<input type="hidden" name="scope" value="${scope}">` : ''}
${select('upto', 'Table after', [['', 'Latest'], ...played.map(d => [d, `Matchday ${d}`])], upTo)}<button type="submit" class="lg-btn" data-apply>Show</button></form>`;
  let status;
  if (t.preSeason) status = `The season starts on ${esc(formatDate(`${comp.start_date}T12:00:00Z`))}. Clubs are listed alphabetically until the first results.`;
  else status = `After Matchday ${esc(t.matchday)}, ${esc(t.matchdayPlayed)} of ${esc(t.matchdayMatches)} matches played${t.updatedAt ? `, updated ${esc(formatDateTime(t.updatedAt))}` : ''}.`;
  if (t.live) status = `<span class="lg-chip live"><span class="lg-pulse" aria-hidden="true"></span>Live table</span> Matches in progress count as they stand; the arrows show changes since they kicked off${t.updatedAt ? `. Updated ${esc(formatDateTime(t.updatedAt))}` : ''}.`;
  // Mini scoreboard: the round being played (confirmed scores only).
  const SB = { live: 'LIVE', half_time: 'HT', full_time: 'FT', postponed: 'Postponed', abandoned: 'Abandoned', cancelled: 'Cancelled', awarded: 'Awarded' };
  const board = (t.scoreboard || []).length ? `<section class="lg-board" aria-label="Matchday ${esc(t.scoreboard[0].matchday)} scores"><h2>Matchday ${esc(t.scoreboard[0].matchday)}</h2><ul>${t.scoreboard.map(m => {
    const score = m.homeGoals != null ? `${esc(m.homeGoals)}–${esc(m.awayGoals)}` : m.status === 'scheduled' ? esc(toLagos(m.kickoff)?.time || '') : '–';
    const tag = SB[m.status] ? `<span class="lg-board-st ${['live', 'half_time'].includes(m.status) ? 'live' : ''}">${SB[m.status]}</span>` : `<span class="lg-board-st">${esc(formatShortDate(m.kickoff || ''))}</span>`;
    return `<li class="${m.home.isLobi || m.away.isLobi ? 'is-lobi' : ''}"><span class="h">${esc(m.home.shortName)}</span><b>${score}</b><span class="a">${esc(m.away.shortName)}</span>${tag}${m.unconfirmed ? '<span class="lg-board-st" title="Only one source so far">unconfirmed</span>' : ''}</li>`;
  }).join('')}</ul></section>` : '';
  const zones = comp.zones || [];
  const zoneOf = pos => zones.find(z => pos >= z.from && pos <= z.to);
  const arrow = m => (m > 0 ? `<span class="lg-mv up" title="Up ${m}"><span aria-hidden="true">▲</span><span class="sr">Up ${m}</span></span>` : m < 0 ? `<span class="lg-mv down" title="Down ${-m}"><span aria-hidden="true">▼</span><span class="sr">Down ${-m}</span></span>` : '<span class="lg-mv same"><span aria-hidden="true">–</span><span class="sr">No change</span></span>');
  const sign = n => (n > 0 ? `+${n}` : String(n));
  const rows = t.rows.map(r => {
    const z = zoneOf(r.pos);
    const team = league.allTeams.find(x => x.id === r.team.id);
    return `<tr class="${r.team.isLobi ? 'is-lobi' : ''}"${z ? ` style="--zone:${esc(z.colour)}" data-zone` : ''}>
<td class="pos"><span>${esc(r.pos)}</span>${t.preSeason ? '' : arrow(r.movement)}</td>
<th scope="row" class="club"><span class="club-in">${crest(team, 26)}<span class="full">${esc(r.team.name)}</span><span class="short">${esc(r.team.shortName)}</span>${r.adjustment ? `<sup title="Points adjustment">*</sup>` : ''}</span></th>
<td class="p">${r.played}</td><td class="ext">${r.won}</td><td class="ext">${r.drawn}</td><td class="ext">${r.lost}</td><td class="ext">${r.gf}</td><td class="ext">${r.ga}</td>
<td class="gd">${sign(r.gd)}</td><td class="pts"><b>${r.points}</b></td>
<td class="form">${r.form.length ? `<span class="lg-form-row">${r.form.map(x => `<span class="lg-f-${x}" title="${x === 'W' ? 'Won' : x === 'D' ? 'Drew' : 'Lost'}">${x}</span>`).join('')}</span><span class="sr">Form, oldest first: ${r.form.map(x => (x === 'W' ? 'won' : x === 'D' ? 'drew' : 'lost')).join(', ')}</span>` : '<span class="lg-small">–</span>'}</td></tr>`;
  }).join('');
  const caption = `${esc(comp.name)} ${esc(comp.season)}${scope !== 'overall' ? `, ${scope} matches only` : ''}${upTo ? `, after Matchday ${upTo}` : ''}`;
  const legend = zones.length ? `<ul class="lg-zones">${zones.map(z => `<li><span style="background:${esc(z.colour)}"></span>${esc(z.label)} (${z.from === z.to ? `position ${z.from}` : `positions ${z.from} to ${z.to}`})</li>`).join('')}</ul>` : '';
  const notes = t.footnotes.map((n, i) => `<li>${i < t.footnotes.length - 2 ? '<span aria-hidden="true">* </span>' : ''}${esc(n)}</li>`).join('');
  return `${tabs}${upto}<p class="lg-status" role="status">${status}</p>${board}
<div class="lg-table-wrap" tabindex="0" role="region" aria-label="League table (scrolls sideways on small screens)">
<table class="lg-table"><caption>${caption}</caption>
<thead><tr><th scope="col" class="pos"><abbr title="Position">Pos</abbr></th><th scope="col" class="club">Club</th><th scope="col" class="p"><abbr title="Played">P</abbr></th>
<th scope="col" class="ext"><abbr title="Won">W</abbr></th><th scope="col" class="ext"><abbr title="Drawn">D</abbr></th><th scope="col" class="ext"><abbr title="Lost">L</abbr></th><th scope="col" class="ext"><abbr title="Goals for">GF</abbr></th><th scope="col" class="ext"><abbr title="Goals against">GA</abbr></th>
<th scope="col" class="gd"><abbr title="Goal difference">GD</abbr></th><th scope="col" class="pts"><abbr title="Points">Pts</abbr></th><th scope="col" class="form">Form</th></tr></thead>
<tbody>${rows}</tbody></table></div>
${legend}<ul class="lg-notes">${notes}</ul>
<div class="lg-acts lg-table-acts"><button type="button" class="lg-btn" data-print>Print</button></div>`;
}

export { matchdaySummary, CRITERION_LABELS };
