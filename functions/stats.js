import { renderPage, fill, esc } from './api/_lib/ssr.js';
import { seasonStats } from './api/_lib/stats.js';

// "/stats" -- season stats rendered on the server from match data entered in
// Admin -> Match Centre. ?season=2026/27 picks the season.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  let roster = [], site = {};
  try { roster = await (await env.ASSETS.fetch(new URL('/data/players.json', url))).json(); } catch {}
  try { site = await (await env.ASSETS.fetch(new URL('/data/site.json', url))).json(); } catch {}
  const startMonth = /^\d{4}-(\d{2})-\d{2}$/.test(site.seasonStart || '') ? Number(site.seasonStart.slice(5, 7)) : 8;
  let data;
  try { data = await seasonStats(env.DB, roster, { season: url.searchParams.get('season') || '', currentSeason: site.currentSeason, startMonth }); }
  catch (err) { console.error('[stats] failed', err); return env.ASSETS.fetch(new URL('/stats/', url)); }

  const t = data.team, a = t.all;
  const rec = r => `${r.w}W ${r.d}D ${r.l}L`;
  let html = '';
  if (data.played) {
    html += `<h2 class="st-h2">Team ${esc(data.season)}</h2><div class="st-team">`
      + [['Played', a.p], ['Won', a.w], ['Drawn', a.d], ['Lost', a.l], ['Goals for', a.gf], ['Goals against', a.ga], ['Longest unbeaten run', t.unbeaten]]
        .map(([l, v]) => `<div class="st-kpi"><b>${v}</b><span>${l}</span></div>`).join('') + '</div>'
      + `<div class="st-records"><div class="st-rec"><strong>Home</strong><span>${rec(t.home)} · ${t.home.gf}–${t.home.ga}</span></div>`
      + `<div class="st-rec"><strong>Away</strong><span>${rec(t.away)} · ${t.away.gf}–${t.away.ga}</span></div>`
      + `<div class="st-rec"><strong>Form (last 5)</strong><span class="st-form">${t.form.map(f => `<i class="${f}" aria-label="${f === 'W' ? 'Win' : f === 'D' ? 'Draw' : 'Loss'}">${f}</i>`).join('')}</span></div></div>`;
  }
  if (data.boards.length) {
    html += `<h2 class="st-h2">Players ${esc(data.season)}</h2><div class="st-boards">` + data.boards.map(b => {
      const text = `Lobi Stars ${b.label} ${data.season}: ${b.rows.slice(0, 3).map((r, i) => `${i + 1}. ${r.name} – ${r.value}`).join(', ')}. More at lobistarsfc.com/stats`;
      return `<section class="st-board" aria-label="${esc(b.label)}"><h3>${esc(b.label)}</h3><ol>`
        + b.rows.map((r, i) => `<li><span class="st-rank">${i + 1}</span>${r.photo ? `<img class="st-face" src="${esc(r.photo)}" alt="" loading="lazy" width="36" height="36">` : `<span class="st-face" aria-hidden="true">${esc(r.number ?? '')}</span>`}<a class="st-name" href="/squad/${esc(r.slug)}/">${esc(r.name)}</a><span class="st-val" aria-label="${r.value} ${esc(b.unit)}">${r.value}</span></li>`).join('')
        + `</ol><div class="st-share"><a href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Share on WhatsApp</a><button type="button" data-share-text="${esc(text)}">Share</button></div></section>`;
    }).join('') + '</div>';
  }
  if (!html) html = `<p class="st-empty">No stats for ${esc(data.season)} yet. They appear here once match results and player stats are entered.</p>`;

  const options = data.seasons.map(s => `<option value="${esc(s)}"${s === data.season ? ' selected' : ''}>${esc(s)}</option>`).join('');
  return renderPage(request, env, '/stats/', [
    ['#season', fill(options)],
    ['#statsBody', fill(html)],
  ]);
}
