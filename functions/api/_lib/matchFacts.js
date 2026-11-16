// "Match facts" for a match page (/matches/<slug>/), sent in the HTML by the server: the competition and
// matchday, kick-off and venue, both teams' league positions, the other meeting between the two teams this
// season, tickets for home games, and links. All from the club's own records (league fixtures and table, the
// ticket shop), so every match page has its own useful, true text for fans and for Google (SEO, Nov 2026).
// Never invents anything: a fact that isn't known is simply left out.
import { loadLeague } from './leagueDb.js';
import { tablePayload } from './leagueApi.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ord = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const naira = kobo => `₦${Math.round(kobo / 100).toLocaleString('en-NG')}`;
const lagos = (iso, opts) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', ...opts });
const DONE = ['full_time', 'awarded'];

export async function matchFactsHtml(env, event, { ticket = null, slug = '' } = {}) {
  let league = null;
  try { league = await loadLeague(env, { publishedOnly: true }); } catch { /* facts from the event only */ }
  const fx = league?.fixtures?.find(f => f.event_id === event.id) || null;
  const items = [];
  const comp = fx?.competition?.short_name || fx?.competition?.name || event.competition;
  items.push(['Competition', `${esc(comp || 'League match')}${fx?.matchday ? `, Matchday ${esc(fx.matchday)}` : ''}`]);
  if (event.event_date) items.push(['Kick-off', `${esc(lagos(event.event_date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}, ${esc(lagos(event.event_date, { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase())} (Nigeria time)`]);
  if (event.venue) items.push(['Venue', esc(event.venue)]);

  if (league && fx) {
    // League positions now (table after the last counted results).
    try {
      const t = tablePayload(league);
      const row = id => t.rows.find(r => r.team.id === id);
      const h = row(fx.home_team_id), a = row(fx.away_team_id);
      if (h && a && !t.preSeason) items.push(['League positions', `${esc(h.team.name)} ${ord(h.pos)} (${h.points} pts), ${esc(a.team.name)} ${ord(a.pos)} (${a.points} pts), ${esc(t.competition.shortName || t.competition.name)}`]);
    } catch { /* table not available */ }
    // The other meeting between the same two teams this season.
    const other = league.fixtures.find(f => f.id !== fx.id && ((f.home_team_id === fx.home_team_id && f.away_team_id === fx.away_team_id) || (f.home_team_id === fx.away_team_id && f.away_team_id === fx.home_team_id)));
    if (other) {
      const name = f => `${f.home?.name || '?'} ${DONE.includes(f.status) && f.home_goals != null ? `${f.home_goals}–${f.away_goals}` : 'v'} ${f.away?.name || '?'}`;
      const when = other.kickoff_at ? lagos(other.kickoff_at, { day: 'numeric', month: 'long', year: 'numeric' }) : 'date to be confirmed';
      items.push([DONE.includes(other.status) ? 'Earlier meeting this season' : 'Other meeting this season', `${esc(name(other))} (${esc(when)}${other.venue?.name ? `, ${esc(other.venue.name)}` : ''})`]);
    }
  }
  if (ticket && /lobi stars/i.test(event.home_team || '')) {
    const t = ticket.state === 'on_sale' ? (ticket.free ? 'Free entry: get your ticket online.' : ticket.fromKobo != null ? `On sale online from ${naira(ticket.fromKobo)}.` : 'On sale online.')
      : ticket.state === 'sold_out' ? 'Sold out.' : ticket.opensAt ? `On sale from ${lagos(ticket.opensAt, { day: 'numeric', month: 'long' })}.` : null;
    if (t) items.push(['Tickets', `${esc(t)} <a href="/tickets/">Lobi Stars tickets</a>`]);
  }
  const links = [`<a href="/fixtures/">All Lobi Stars fixtures</a>`, `<a href="/table/">NNL Conference D table</a>`];
  if (/lobi stars/i.test(event.home_team || '') && slug) links.unshift(`<a href="/matches/${esc(slug)}/live/">Matchday Live</a>`);

  return `<section class="wrap mfacts" aria-labelledby="mfacts-h">
<h2 id="mfacts-h">Match facts: ${esc(event.home_team)} vs ${esc(event.away_team)}</h2>
<dl>${items.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>
<p class="mfacts-links">${links.join(' · ')}</p>
</section>
<style>.mfacts{margin:28px auto 8px}.mfacts h2{font:400 26px/1.1 'Bebas Neue',Impact,sans-serif;letter-spacing:.5px;margin:0 0 12px;color:var(--white,#111)}.mfacts dl{margin:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px 24px}.mfacts dl div{border-top:1px solid var(--d4,#e2e5e9);padding-top:8px}.mfacts dt{font:700 12px/1.2 'Barlow Condensed',sans-serif;letter-spacing:1.2px;text-transform:uppercase;color:var(--lt,#5b6472);margin-bottom:3px}.mfacts dd{margin:0;font-size:15px;line-height:1.45}.mfacts a{color:var(--red-text,#c11a1f)}.mfacts-links{margin:14px 0 0;font-size:14px}</style>`;
}
