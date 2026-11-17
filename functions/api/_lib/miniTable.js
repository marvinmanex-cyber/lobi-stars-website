// The homepage's small league table (Pos, Club, P, GD, Pts), built on the server so the page does not jump when
// the table arrives (it used to load in the browser and push the page down: layout shift, Nov 2026). Same data and
// markup as the browser version in src/components/league/MiniTable.astro.
import { loadLeague } from './leagueDb.js';
import { tablePayload } from './leagueApi.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sign = n => (n > 0 ? `+${n}` : String(n));

/** The table as HTML, or '' (the browser then loads it as before). */
export function miniTableHtml(t) {
  if (!t?.rows?.length) return '';
  const caption = t.preSeason ? 'Before the first match' : t.live ? 'Live table: matches in play count as they stand' : `After Matchday ${t.matchday}`;
  const rows = t.rows.map(r => `<tr class="${r.team.isLobi ? 'is-lobi' : ''}"><td>${esc(r.pos)}</td><th scope="row"><img class="club-logo" src="${esc(r.team.crest)}" alt="" width="22" height="22" loading="lazy">${esc(r.team.shortName)}</th><td>${esc(r.played)}</td><td>${esc(sign(r.gd))}</td><td><b>${esc(r.points)}</b></td></tr>`).join('');
  return `<table><caption>${esc(caption)}</caption><thead><tr><th scope="col">Pos</th><th scope="col">Club</th><th scope="col">P</th><th scope="col">GD</th><th scope="col">Pts</th></tr></thead><tbody>${rows}</tbody></table>`;
}
export async function miniTableFor(env) {
  try {
    const league = await loadLeague(env, { slug: null });
    if (!league?.competition?.has_table) return '';
    return miniTableHtml(tablePayload(league, { scope: 'overall', upTo: null }));
  } catch (err) { console.error('[home] mini table', err); return ''; }
}
