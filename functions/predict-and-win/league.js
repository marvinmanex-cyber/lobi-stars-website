import { renderPage, fill, esc } from '../api/_lib/ssr.js';
import { seasonLeague, POINTS_EXACT, POINTS_RESULT } from '../api/_lib/predictLeague.js';
import { seasonConfig } from '../api/_lib/seasonConfig.js';

// "/predict-and-win/league" -- the Season Prediction League table, rendered
// on the server. ?season=2026/27 picks the season.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  let data;
  try { data = await seasonLeague(env.DB, { season: url.searchParams.get('season') || '', ...(await seasonConfig(env, request)) }); }
  catch (err) { console.error('[league] failed', err); return env.ASSETS.fetch(new URL('/predict-and-win/league/', url)); }

  let html;
  if (!data.rows.length) {
    html = `<p class="lg-empty">No points yet for ${esc(data.season)}. The table fills up after each Lobi Stars home game once the final score is in: ${POINTS_EXACT} points for an exact score, ${POINTS_RESULT} for the correct result.</p>`;
  } else {
    html = `<p class="lg-meta">${data.games} home game${data.games === 1 ? '' : 's'} counted &middot; ${data.rows.length} fan${data.rows.length === 1 ? '' : 's'}</p>`
      + `<div class="lg-scroll"><table class="lg-table"><caption class="sr-only">Prediction League ${esc(data.season)}</caption><thead><tr>`
      + `<th scope="col">Rank</th><th scope="col">Fan</th><th scope="col">Points</th><th scope="col"><abbr title="Exact scores">Exact</abbr></th><th scope="col"><abbr title="Predictions made">Played</abbr></th></tr></thead><tbody>`
      + data.rows.slice(0, 100).map(r => `<tr${r.rank <= 3 ? ` class="lg-top lg-top${r.rank}"` : ''}><td class="lg-rank">${r.rank}</td><td>${esc(r.name)}</td><td class="lg-pts">${r.points}</td><td>${r.exact}</td><td>${r.predictions}</td></tr>`).join('')
      + `</tbody></table></div>`
      + (data.rows.length > 100 ? `<p class="lg-meta">Showing the top 100. Log in to see your own rank on <a href="/fans/account/">your account</a>.</p>` : '');
  }
  const options = data.seasons.map(s => `<option value="${esc(s)}"${s === data.season ? ' selected' : ''}>${esc(s)}</option>`).join('');
  return renderPage(request, env, '/predict-and-win/league/', [
    ['#season', fill(options)],
    ['#leagueBody', fill(html)],
  ]);
}
